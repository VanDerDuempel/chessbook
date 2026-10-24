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
  private readonly db: Database.Database;

  constructor(readonly file: string, readonly backupDir = path.join(path.dirname(file), 'backups')) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
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

  /** Löscht die Stellungen und alles, was danach von der Startstellung aus nicht mehr erreichbar ist. */
  deleteNodes(rep: Rep, keys: string[], dry = false) {
    if (!keys.length) throw new Error('Keine Stellung zum Löschen angegeben');
    const drop = new Set(keys);
    if (drop.has(START_KEY)) throw new Error('Die Startstellung kann nicht gelöscht werden');
    const adj = new Map<string, string[]>();
    for (const e of this.db.prepare('SELECT from_key f,to_key t FROM moves WHERE repertoire=?').all(rep) as { f: string; t: string }[])
      (adj.get(e.f) ?? adj.set(e.f, []).get(e.f)!).push(e.t);
    const seen = new Set([START_KEY]);
    const stack = [START_KEY];
    while (stack.length) for (const t of adj.get(stack.pop()!) ?? []) if (!drop.has(t) && !seen.has(t)) { seen.add(t); stack.push(t); }
    const dead = (this.db.prepare('SELECT key FROM positions WHERE repertoire=?').all(rep) as { key: string }[])
      .map(r => r.key).filter(k => !seen.has(k));
    if (!dry && dead.length) {
      this.backup('vor-loeschen', 10 * 60_000);
      const del = this.db.prepare('DELETE FROM positions WHERE repertoire=? AND key=?');
      this.db.transaction(() => dead.forEach(k => del.run(rep, k)))();
    }
    return { removed: dead.length };
  }

  /** Zugreihenfolge ändern: der Zug von `from` nach `to` wird Hauptvariante ('main') oder rückt eine Stelle vor ('up') bzw. zurück ('down'). */
  reorderMove(rep: Rep, from: string, to: string, dir: 'main' | 'up' | 'down') {
    return this.db.transaction(() => {
      const rows = this.db.prepare('SELECT uci,to_key FROM moves WHERE repertoire=? AND from_key=? ORDER BY ord').all(rep, from) as { uci: string; to_key: string }[];
      const i = rows.findIndex(r => r.to_key === to);
      if (i < 0) throw new Error('Zug unbekannt');
      const j = dir === 'main' ? 0 : dir === 'up' ? Math.max(0, i - 1) : Math.min(rows.length - 1, i + 1);
      rows.splice(j, 0, ...rows.splice(i, 1));
      const up = this.db.prepare('UPDATE moves SET ord=? WHERE repertoire=? AND from_key=? AND uci=?');
      rows.forEach((r, n) => up.run(n + 1, rep, from, r.uci));
      return { order: rows.map(r => r.to_key) };
    })();
  }

  setShapes(rep: Rep, key: string, shapes: Shape[]) {
    if (!Array.isArray(shapes)) throw new Error('shapes muss eine Liste sein');
    this.fenOf(rep, key);
    this.db.prepare('UPDATE positions SET shapes=? WHERE repertoire=? AND key=?').run(JSON.stringify(shapes), rep, key);
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

  /** Liest einen JSON-Export dieses Programms ein (fügt hinzu, ersetzt nichts). Geprüft und übernommen werden nur die gewählten Repertoires. */
  importJson(data: any, reps: Rep[] = REPS) {
    if (!reps.length) throw new Error('Kein Repertoire gewählt');
    for (const rep of reps) if (!data?.[rep]?.positions || !data[rep].moves) throw new Error(`Ungültiges Format (${rep})`);
    const stats = { positions: 0, moves: 0, skipped: 0, shapes: 0 };
    this.backup('vor-import');
    this.db.transaction(() => {
      for (const rep of reps) {
        const g = data[rep];
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
}
