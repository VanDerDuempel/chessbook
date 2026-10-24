import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, type Rep } from './db';
import { ExplorerClient, type ExplorerProgress } from './explorer';
import { scanGaps, type Gap, type OwnGap } from './gaps';
import { loadConfig, saveConfig, patchConfig } from './config';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const DB_FILE = process.env.CHESSBOOK_DB ?? path.join(ROOT, 'data', 'chessbook.db');
const store = new Store(DB_FILE);
store.backup('start', 12 * 3600_000);

// Lücken-Erkennung: Einstellungen (inkl. Lichess-Token) liegen nur lokal in data/config.json
const CONFIG_FILE = path.join(path.dirname(DB_FILE), 'config.json');
let config = loadConfig(CONFIG_FILE);
const publicConfig = () => ({ tokenSet: !!config.lichessToken, source: config.source, player: config.player, playerColor: config.playerColor, thresholds: config.thresholds });
// indexing: Lichess liest den Spieler gerade ein (Warteschlange, bisher gezählte Partien), sonst null
interface Job { state: 'running' | 'done' | 'error'; queried: number; open: number; message: string; gaps: Gap[]; own: OwnGap[]; source: string; player: string; color: string; indexing: ExplorerProgress | null }
const jobs: Partial<Record<Rep, Job>> = {};
let scanning = false;
function startScan(rep: Rep): Job {
  if (scanning) throw new Error('Es läuft bereits eine Suche. Bitte warten.');
  if (config.source === 'player' && !config.player) throw new Error('Bitte zuerst einen Spielernamen eingeben.');
  scanning = true;
  // Beim Spieler gilt standardmäßig die Seite des Gegners: bei deinem Weiß-Repertoire seine Partien mit Schwarz und umgekehrt
  const color = config.playerColor === 'auto' ? (rep === 'white' ? 'black' : 'white') : config.playerColor;
  const job: Job = { state: 'running', queried: 0, open: 0, message: '', gaps: [], own: [], source: config.source, player: config.player, color, indexing: null };
  jobs[rep] = job;
  const client = new ExplorerClient({
    token: config.lichessToken, settings: { source: config.source, player: config.player, color },
    baseUrl: process.env.CHESSBOOK_EXPLORER_URL, delayMs: Number(process.env.CHESSBOOK_EXPLORER_DELAY ?? 1100), retryWaitMs: Number(process.env.CHESSBOOK_EXPLORER_RETRY ?? 60_000),
  });
  const cfgKey = config.source === 'player' ? `player|${config.player.toLowerCase()}|${color}` : config.source;
  const maxAge = (config.source === 'player' ? 2 : 14) * 86_400_000;
  const getData = async (key: string, fen: string) => {
    const cached = store.cacheGet(key, cfgKey, maxAge);
    if (cached) return cached;
    try {
      // Einlese-Fortschritt gibt es nur beim Spieler-Explorer; bei Masters/Lichess nicht anzeigen
      const d = await client.query(fen, job.source === 'player' ? p => { job.indexing = p; } : undefined);
      store.cachePut(key, cfgKey, d);
      return d;
    } finally { job.indexing = null; }
  };
  scanGaps(store.state(rep), rep, getData, { ...config.thresholds[config.source], minReach: config.minReach }, (q, o) => { job.queried = q; job.open = o; })
    .then(r => { job.gaps = r.gaps; job.own = r.own; job.state = 'done'; })
    .catch(e => { job.state = 'error'; job.message = (e as Error).message; })
    .finally(() => { scanning = false; });
  return job;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};
const rep = (v: unknown): Rep => {
  if (v === 'white' || v === 'black') return v;
  throw new Error('Repertoire muss "white" oder "black" sein');
};
async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > 50e6) throw new Error('Anfrage zu groß'); chunks.push(c as Buffer); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
const send = (res: http.ServerResponse, code: number, data: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

const server = http.createServer(async (req, res) => {
  try {
    // Schutz vor fremden Webseiten und DNS-Rebinding: nur lokale Host-Header, Schreibzugriffe nur als JSON
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (host !== 'localhost' && host !== '127.0.0.1') return send(res, 403, { error: 'Nur lokal erreichbar' });
    const p = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (p.startsWith('/api/')) {
      if (req.method === 'GET') {
        if (p === '/api/gaps-config') return send(res, 200, publicConfig());
        if (p.startsWith('/api/gaps/')) return send(res, 200, jobs[rep(p.slice(10))] ?? { state: 'none', queried: 0, open: 0, message: '', gaps: [], own: [], source: '', player: '', color: '', indexing: null });
        if (p === '/api/export') return send(res, 200, store.exportAll());
        if (p.startsWith('/api/export-pgn/')) {
          res.writeHead(200, { 'content-type': 'application/x-chess-pgn; charset=utf-8' });
          return res.end(store.exportPgn(rep(p.slice(16))));
        }
        if (p.startsWith('/api/state/')) return send(res, 200, store.state(rep(p.slice(11))));
        return send(res, 404, { error: 'Unbekannte Route' });
      }
      if (!(req.headers['content-type'] ?? '').includes('application/json')) return send(res, 415, { error: 'Nur JSON erlaubt' });
      const b = await readBody(req);
      if (req.method === 'POST' && p === '/api/move') return send(res, 200, store.addMove(rep(b.rep), String(b.from), String(b.uci)));
      if (req.method === 'POST' && p === '/api/reorder') {
        const d = String(b.dir);
        if (d !== 'main' && d !== 'up' && d !== 'down') throw new Error('Richtung ungültig');
        return send(res, 200, store.reorderMove(rep(b.rep), String(b.from), String(b.to), d));
      }
      if (req.method === 'POST' && p === '/api/delete') return send(res, 200, store.deleteNodes(rep(b.rep), Array.isArray(b.keys) ? b.keys.map(String) : [String(b.key)], !!b.dry));
      if (req.method === 'PUT' && p === '/api/gaps-config') { config = patchConfig(config, b); saveConfig(CONFIG_FILE, config); return send(res, 200, publicConfig()); }
      if (req.method === 'POST' && p === '/api/gaps/scan') return send(res, 200, startScan(rep(b.rep)));
      if (req.method === 'POST' && p === '/api/move-san') return send(res, 200, store.addSan(rep(b.rep), String(b.from), String(b.san)));
      if (req.method === 'PUT' && p === '/api/shapes') { store.setShapes(rep(b.rep), String(b.key), b.shapes); return send(res, 200, { ok: true }); }
      if (req.method === 'POST' && p === '/api/import-json') {
        // Alt: Export-JSON direkt als Body. Neu: {data, reps?}
        if (b.white && b.black) return send(res, 200, store.importJson(b));
        if (b.reps !== undefined && !Array.isArray(b.reps)) throw new Error('reps muss eine Liste sein');
        return send(res, 200, store.importJson(b.data, b.reps?.map(rep)));
      }
      if (req.method === 'POST' && p === '/api/import-pgn') return send(res, 200, store.importPgn(rep(b.rep), String(b.text ?? '')));
      return send(res, 404, { error: 'Unbekannte Route' });
    }

    const file = path.join(PUBLIC, path.normalize(p === '/' ? '/index.html' : p));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Nicht gefunden'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, 400, { error: (e as Error).message });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, '127.0.0.1', () => console.log(`Chessbook läuft auf http://localhost:${port}`));
