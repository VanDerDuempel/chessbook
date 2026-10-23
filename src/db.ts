import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { parsePgn, startingPosition, makePgn, defaultGame, ChildNode, parseComment, makeComment, type Node, type PgnNodeData, type CommentShapeColor } from 'chessops/pgn';
import { parseSquare, makeSquare } from 'chessops/util';
import { START_KEY, START_FEN, fromFen, keyOf, playUci, playSan, type Played } from './core';

export type Rep = 'white' | 'black';
export interface Shape { orig: string; dest?: string; brush: string }
export interface MoveRow { san: string; uci: string; to: string }
export interface State {
  root: string;
  positions: Record<string, { fen: string; shapes: Shape[] }>;
  moves: Record<string, MoveRow[]>;
}

const REPS: Rep[] = ['white', 'black'];
const SCHEMA = `
CREATE TABLE IF NOT EXISTS positions(
  repertoire TEXT NOT NULL CHECK(repertoire IN ('white','black')),
  key TEXT NOT NULL, fen TEXT NOT NULL, shapes TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY(repertoire,key));
CREATE TABLE IF NOT EXISTS moves(
  repertoire TEXT NOT NULL, from_key TEXT NOT NULL, to_key TEXT NOT NULL,
  uci TEXT NOT NULL, san TEXT NOT NULL, ord INTEGER NOT NULL,
  PRIMARY KEY(repertoire,from_key,uci),
  FOREIGN KEY(repertoire,from_key) REFERENCES positions(repertoire,key) ON DELETE CASCADE,
  FOREIGN KEY(repertoire,to_key) REFERENCES positions(repertoire,key) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS moves_to ON moves(repertoire,to_key);
CREATE TABLE IF NOT EXISTS explorer_cache(
  key TEXT NOT NULL, cfg TEXT NOT NULL, fetched_at INTEGER NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY(key,cfg));`;

export class Store {
  readonly db: Database.Database;

  constructor(readonly file: string, readonly backupDir = path.join(path.dirname(file), 'backups')) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    const version = this.db.pragma('user_version', { simple: true }) as number;
    this.db.exec(SCHEMA);
    if (version < 2) { this.migrateCastling(); this.db.pragma('user_version = 2'); }
    const ins = this.db.prepare('INSERT OR IGNORE INTO positions(repertoire,key,fen) VALUES(?,?,?)');
    for (const r of REPS) ins.run(r, START_KEY, START_FEN);
  }

  /** Zwischenspeicher für Eröffnungsdaten (spart Anfragen an Lichess). */
  cacheGet(key: string, cfg: string, maxAgeMs: number): any | null {
    const r = this.db.prepare('SELECT data,fetched_at t FROM explorer_cache WHERE key=? AND cfg=?').get(key, cfg) as { data: string; t: number } | undefined;
    return r && Date.now() - r.t < maxAgeMs ? JSON.parse(r.data) : null;
  }
  cachePut(key: string, cfg: string, data: unknown) {
    this.db.prepare('INSERT OR REPLACE INTO explorer_cache(key,cfg,fetched_at,data) VALUES(?,?,?,?)').run(key, cfg, Date.now(), JSON.stringify(data));
  }

  /** Ältere Versionen haben Rochaden als "König schlägt Turm" (e1h1) gespeichert, neuere als e1g1. Beide Schreibweisen führten zu doppelten Kanten. */
  private migrateCastling() {
    const where = "san LIKE 'O-O%' AND uci IN ('e1h1','e1a1','e8h8','e8a8')";
    const n = (this.db.prepare(`SELECT COUNT(*) c FROM moves WHERE ${where}`).get() as { c: number }).c;
    if (!n) return;
    this.backup('vor-migration');
    this.db.transaction(() => {
      this.db.exec(`UPDATE OR IGNORE moves SET uci = CASE uci WHEN 'e1h1' THEN 'e1g1' WHEN 'e1a1' THEN 'e1c1' WHEN 'e8h8' THEN 'e8g8' ELSE 'e8c8' END WHERE ${where}`);
      this.db.exec(`DELETE FROM moves WHERE ${where}`);
    })();
  }

  /** Sicherungskopie der Datenbank. Mit minAgeMs wird übersprungen, wenn schon eine frische existiert. */
  backup(label: string, minAgeMs = 0): string | null {
    fs.mkdirSync(this.backupDir, { recursive: true });
    const files = fs.readdirSync(this.backupDir).filter(n => n.endsWith('.db')).sort();
    if (minAgeMs && files.length) {
      const age = Date.now() - fs.statSync(path.join(this.backupDir, files[files.length - 1])).mtimeMs;
      if (age < minAgeMs) return null;
    }
    const name = `chessbook-${new Date().toISOString().replace(/[:.]/g, '-')}-${label.replace(/[^\w-]/g, '')}.db`;
    const target = path.join(this.backupDir, name);
    this.db.prepare('VACUUM INTO ?').run(target);
    fs.readdirSync(this.backupDir).filter(n => n.endsWith('.db')).sort().reverse().slice(30)
      .forEach(n => fs.rmSync(path.join(this.backupDir, n)));
    return target;
  }

  state(rep: Rep): State {
    const positions: State['positions'] = {};
    for (const r of this.db.prepare('SELECT key,fen,shapes FROM positions WHERE repertoire=?').all(rep) as any[])
      positions[r.key] = { fen: r.fen, shapes: JSON.parse(r.shapes) };
    const moves: State['moves'] = {};
    for (const r of this.db.prepare('SELECT from_key,to_key,uci,san FROM moves WHERE repertoire=? ORDER BY ord').all(rep) as any[])
      (moves[r.from_key] ??= []).push({ san: r.san, uci: r.uci, to: r.to_key });
    return { root: START_KEY, positions, moves };
  }

  exportAll() {
    return { version: 1, white: this.state('white'), black: this.state('black') };
  }

  private fenOf(rep: Rep, key: string): string {
    const row = this.db.prepare('SELECT fen FROM positions WHERE repertoire=? AND key=?').get(rep, key) as { fen: string } | undefined;
    if (!row) throw new Error('Stellung unbekannt');
    return row.fen;
  }

  private insertPlayed(rep: Rep, from: string, p: Played) {
    return this.db.transaction(() => {
      const np = this.db.prepare('INSERT OR IGNORE INTO positions(repertoire,key,fen) VALUES(?,?,?)').run(rep, p.key, p.fen).changes > 0;
      const nm = this.db.prepare(
        `INSERT OR IGNORE INTO moves(repertoire,from_key,to_key,uci,san,ord)
         VALUES(?,?,?,?,?,(SELECT COALESCE(MAX(ord),0)+1 FROM moves WHERE repertoire=? AND from_key=?))`
      ).run(rep, from, p.key, p.uci, p.san, rep, from).changes > 0;
      return { toKey: p.key, san: p.san, newPosition: np, newMove: nm };
    })();
  }

  addMove(rep: Rep, from: string, uci: string) {
    const p = playUci(fromFen(this.fenOf(rep, from)), uci);
    if (!p) throw new Error('Zug nicht erlaubt');
    return this.insertPlayed(rep, from, p);
  }

  addSan(rep: Rep, from: string, san: string) {
    const p = playSan(fromFen(this.fenOf(rep, from)), san);
    if (!p) throw new Error(`Zug nicht erlaubt: ${san}`);
    return this.insertPlayed(rep, from, p);
  }

  /** Löscht die Stellung und alles, was danach von der Startstellung aus nicht mehr erreichbar ist. */
  deleteNode(rep: Rep, key: string, dry = false) {
    if (key === START_KEY) throw new Error('Die Startstellung kann nicht gelöscht werden');
    const adj = new Map<string, string[]>();
    for (const e of this.db.prepare('SELECT from_key f,to_key t FROM moves WHERE repertoire=?').all(rep) as { f: string; t: string }[])
      (adj.get(e.f) ?? adj.set(e.f, []).get(e.f)!).push(e.t);
    const seen = new Set([START_KEY]);
    const stack = [START_KEY];
    while (stack.length) for (const t of adj.get(stack.pop()!) ?? []) if (t !== key && !seen.has(t)) { seen.add(t); stack.push(t); }
    const dead = (this.db.prepare('SELECT key FROM positions WHERE repertoire=?').all(rep) as { key: string }[])
      .map(r => r.key).filter(k => !seen.has(k));
    if (!dry && dead.length) {
      this.backup('vor-loeschen', 10 * 60_000);
      const del = this.db.prepare('DELETE FROM positions WHERE repertoire=? AND key=?');
      this.db.transaction(() => dead.forEach(k => del.run(rep, k)))();
    }
    return { removed: dead.length };
  }

  setShapes(rep: Rep, key: string, shapes: Shape[]) {
    if (!Array.isArray(shapes)) throw new Error('shapes muss eine Liste sein');
    this.fenOf(rep, key);
    this.db.prepare('UPDATE positions SET shapes=? WHERE repertoire=? AND key=?').run(JSON.stringify(shapes), rep, key);
  }

  /** Liest das JSON aus dem Daten-Feld des Prototyps ein (fügt hinzu, ersetzt nichts). */
  importPrototype(data: any) {
    const BRUSH: Record<string, string> = { g: 'green', r: 'red', b: 'blue', y: 'yellow' };
    const stats = { positions: 0, moves: 0, skipped: 0, shapes: 0 };
    this.backup('vor-import');
    this.db.transaction(() => {
      for (const [pk, rep] of [['w', 'white'], ['b', 'black']] as const) {
        const g = data?.[pk];
        if (!g?.root || !g.nodes || !g.edges) throw new Error(`Ungültiges Format (${pk})`);
        const map = new Map<string, string>([[g.root, START_KEY]]);
        const queue: string[] = [g.root];
        const done = new Set<string>();
        while (queue.length) {
          const pkey = queue.shift()!;
          if (done.has(pkey)) continue;
          done.add(pkey);
          for (const e of g.edges[pkey] ?? []) {
            try {
              const r = this.addSan(rep, map.get(pkey)!, String(e.san));
              if (r.newPosition) stats.positions++;
              if (r.newMove) stats.moves++;
              if (!map.has(e.to)) map.set(e.to, r.toKey);
              queue.push(e.to);
            } catch { stats.skipped++; }
          }
        }
        for (const [pkey, key] of map) {
          const shapes: Shape[] = (g.nodes[pkey]?.arrows ?? [])
            .filter((a: any) => BRUSH[a?.c] && /^[a-h][1-8]$/.test(a.f) && /^[a-h][1-8]$/.test(a.t))
            .map((a: any) => (a.f === a.t ? { orig: a.f, brush: BRUSH[a.c] } : { orig: a.f, dest: a.t, brush: BRUSH[a.c] }));
          if (shapes.length) { this.setShapes(rep, key, shapes); stats.shapes += shapes.length; }
        }
      }
    })();
    return stats;
  }

  /** Fügt Pfeile und Kreise zu den vorhandenen hinzu (ohne Doppelte). */
  mergeShapes(rep: Rep, key: string, add: Shape[]) {
    const row = this.db.prepare('SELECT shapes FROM positions WHERE repertoire=? AND key=?').get(rep, key) as { shapes: string } | undefined;
    if (!row) return 0;
    const have: Shape[] = JSON.parse(row.shapes);
    const id = (x: Shape) => `${x.orig}|${x.dest ?? ''}|${x.brush}`;
    const known = new Set(have.map(id));
    const fresh = add.filter(x => !known.has(id(x)));
    if (fresh.length) this.setShapes(rep, key, [...have, ...fresh]);
    return fresh.length;
  }

  /** Liest ein PGN (mit Varianten) in das angegebene Repertoire ein. Pfeile und Kreise aus [%cal]/[%csl] werden übernommen. */
  importPgn(rep: Rep, text: string) {
    const stats = { games: 0, positions: 0, moves: 0, skipped: 0, shapes: 0 };
    this.backup('vor-pgn-import');
    this.db.transaction(() => {
      for (const game of parsePgn(text)) {
        let start;
        try { start = startingPosition(game.headers).unwrap(); } catch { stats.skipped++; continue; }
        if (keyOf(start as any) !== START_KEY) { stats.skipped++; continue; }
        stats.games++;
        const walk = (node: Node<PgnNodeData>, key: string) => {
          for (const child of node.children) {
            let r;
            try { r = this.addSan(rep, key, child.data.san); } catch { stats.skipped++; continue; }
            if (r.newPosition) stats.positions++;
            if (r.newMove) stats.moves++;
            const shapes: Shape[] = (child.data.comments ?? []).flatMap(c => parseComment(c).shapes).map(sh => ({
              orig: makeSquare(sh.from), ...(sh.from !== sh.to ? { dest: makeSquare(sh.to) } : {}), brush: sh.color }));
            if (shapes.length) stats.shapes += this.mergeShapes(rep, r.toKey, shapes);
            walk(child, r.toKey);
          }
        };
        walk(game.moves, START_KEY);
      }
    })();
    return stats;
  }

  /** Exportiert ein Repertoire als PGN. Jede Stellung wird einmal ausgeschrieben; Transpositionen verweisen auf die erste Stelle, ein erneuter Import ergibt denselben Graphen. */
  exportPgn(rep: Rep): string {
    const st = this.state(rep);
    const game = defaultGame<PgnNodeData>(() => new Map([
      ['Event', `Chessbook ${rep === 'white' ? 'Weiß' : 'Schwarz'}`], ['Site', 'lokal'], ['Result', '*']]));
    const seen = new Set([START_KEY]);
    const build = (key: string, node: Node<PgnNodeData>) => {
      for (const m of st.moves[key] ?? []) {
        const child = new ChildNode<PgnNodeData>({ san: m.san });
        const shapes = st.positions[m.to]?.shapes ?? [];
        if (shapes.length && !seen.has(m.to))
          child.data.comments = [makeComment({ shapes: shapes.map(x => ({
            color: x.brush as CommentShapeColor, from: parseSquare(x.orig)!, to: parseSquare(x.dest ?? x.orig)! })) })];
        node.children.push(child);
        if (!seen.has(m.to)) { seen.add(m.to); build(m.to, child); }
      }
    };
    build(START_KEY, game.moves);
    return makePgn(game) + '\n';
  }

  /** Liest einen Export dieses Programms (version 1) ein. */
  importState(data: any) {
    const stats = { positions: 0, moves: 0, skipped: 0, shapes: 0 };
    this.backup('vor-import');
    this.db.transaction(() => {
      for (const rep of REPS) {
        const g = data?.[rep];
        if (!g?.positions || !g.moves) throw new Error(`Ungültiges Format (${rep})`);
        const done = new Set<string>();
        const queue = [START_KEY];
        while (queue.length) {
          const key = queue.shift()!;
          if (done.has(key)) continue;
          done.add(key);
          for (const m of g.moves[key] ?? []) {
            try {
              const r = this.addMove(rep, key, String(m.uci));
              if (r.newPosition) stats.positions++;
              if (r.newMove) stats.moves++;
              queue.push(r.toKey);
            } catch { stats.skipped++; }
          }
        }
        for (const [key, pos] of Object.entries<any>(g.positions))
          if (pos?.shapes?.length) stats.shapes += this.mergeShapes(rep, key, pos.shapes);
      }
    })();
    return stats;
  }

  /** Erkennt, ob es ein Prototyp-Export ({w,b}) oder ein Export dieses Programms ({white,black}) ist. */
  importJson(data: any) {
    if (data?.white && data?.black) return this.importState(data);
    return this.importPrototype(data);
  }
}
