import type { Chess } from 'chessops/chess';
import { startPos, START_KEY, playSan } from './core';
import type { State, Rep } from './db';
import { LICHESS_URL, NAME, lichessGet } from './lichess';

export interface LichessGame { id: string; white: string; black: string; moves: string[]; date: number }
export interface GameRef { id: string; color: 'white' | 'black'; ply: number; date: number; opponent: string; account: string }
export interface Deviation { kind: 'own' | 'opp'; key: string; san: string; uci: string; book: string[]; count: number; games: GameRef[] }
export interface CheckResult { games: number; clean: number; deviations: Deviation[] }

const playerName = (p: any): string =>
  p?.user?.name ? String(p.user.name) : p?.aiLevel ? `Stockfish ${p.aiLevel}` : 'Anonym';

/** Eine Zeile des Lichess-Partienexports (NDJSON). Nur Standardschach ab Grundstellung. */
export function parseGame(j: any): LichessGame | null {
  if (!j || typeof j !== 'object' || typeof j.id !== 'string') return null;
  if ((j.variant ?? 'standard') !== 'standard' || j.initialFen) return null;
  return {
    id: j.id, white: playerName(j.players?.white), black: playerName(j.players?.black),
    moves: typeof j.moves === 'string' ? j.moves.split(' ').filter(Boolean) : [], date: Number(j.createdAt) || 0,
  };
}

/** Gleicht Partien mit dem Repertoire ab. Rein, ohne I/O. */
export function checkGames(st: State, rep: Rep, users: string[], games: LichessGame[]): CheckResult {
  const u = new Set(users.map(x => x.toLowerCase()));
  const groups = new Map<string, Deviation>();
  let count = 0, clean = 0;
  for (const g of games) {
    if (!u.has(g[rep].toLowerCase())) continue;
    count++;
    const r = walk(st, g.moves);
    if (r === 'clean') { clean++; continue; }
    if (r === 'illegal') continue;
    const { pos, key, i, uci, san } = r;
    const id = key + ' ' + uci;
    let d = groups.get(id);
    if (!d) {
      d = { kind: pos.turn === rep ? 'own' : 'opp', key, san, uci, book: (st.moves[key] ?? []).map(m => m.san), count: 0, games: [] };
      groups.set(id, d);
    }
    d.count++;
    d.games.push({ id: g.id, color: rep, ply: i + 1, date: g.date, opponent: rep === 'white' ? g.black : g.white, account: g[rep] });
  }
  const devs = [...groups.values()];
  for (const d of devs) d.games.sort((a, b) => b.date - a.date);
  devs.sort((a, b) => b.count - a.count || b.games[0].date - a.games[0].date);
  return { games: count, clean, deviations: devs };
}

type Walk = 'clean' | 'illegal' | { pos: Chess; key: string; i: number; uci: string; san: string };
function walk(st: State, moves: string[]): Walk {
  let pos = startPos(), key = START_KEY;
  for (let i = 0; i < moves.length; i++) {
    const edges = st.moves[key] ?? [];
    if (!edges.length) return 'clean';                       // Repertoire endet hier
    const p = playSan(pos, moves[i]);
    if (!p) return 'illegal';
    if (edges.some(e => e.uci === p.uci)) { pos = p.pos; key = p.key; continue; }
    // Zugumstellung: Führen die weiteren Züge zurück in eine bekannte Stellung, geht die Prüfung dort weiter
    let q: typeof p | null = p, j = i;
    while (q && !st.positions[q.key] && ++j < moves.length) q = playSan(q.pos, moves[j]);
    if (q && st.positions[q.key]) { pos = q.pos; key = q.key; i = j; continue; }
    return { pos, key, i, uci: p.uci, san: p.san };
  }
  return 'clean';
}

/** Lädt die eigenen Partien von Lichess: aus `accounts` (je `max`) oder, wenn leer, vom Account hinter dem Token. */
export async function fetchGames(o: { token: string; accounts?: string[]; max: number; baseUrl?: string; fetchFn?: typeof fetch }): Promise<{ users: string[]; games: LichessGame[] }> {
  if (!o.token && !o.accounts?.length) throw new Error('Bitte einen Lichess-Account oder Token eintragen.');
  const base = (o.baseUrl ?? LICHESS_URL).replace(/\/$/, '');
  const get = (url: string, accept: string, who?: string) => lichessGet(url, { accept, token: o.token, fetchFn: o.fetchFn, who });
  let users = o.accounts?.length ? [...o.accounts] : [];
  if (!users.length) {
    let user = '';
    try { user = String(JSON.parse(await get(`${base}/api/account`, 'application/json')).username ?? ''); } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
    if (!user) throw new Error('Lichess liefert keinen Benutzernamen.');
    users = [user];
  }
  const q = `max=${o.max}&moves=true&tags=false&clocks=false&evals=false&opening=false&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence`;
  const games = new Map<string, LichessGame>();
  for (const u of users) {
    const text = await get(`${base}/api/games/user/${encodeURIComponent(u)}?${q}`, 'application/x-ndjson', u);
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let j: any;
      try { j = JSON.parse(line); } catch { continue; }
      const g = parseGame(j);
      if (g && !games.has(g.id)) games.set(g.id, g);   // Partien zwischen eigenen Accounts kommen doppelt
    }
  }
  return { users, games: [...games.values()] };
}

export interface LichessUser { name: string; title?: string }
/** Namenssuche wie im Lichess-Suchfeld, höchstens 10 Treffer. Ungültige Eingaben ergeben ohne Anfrage eine leere Liste. */
export async function searchUsers(o: { term: string; token?: string; baseUrl?: string; fetchFn?: typeof fetch }): Promise<LichessUser[]> {
  const term = String(o.term ?? '').trim();
  if (!NAME.test(term)) return [];
  const base = (o.baseUrl ?? LICHESS_URL).replace(/\/$/, '');
  const text = await lichessGet(`${base}/api/player/autocomplete?term=${encodeURIComponent(term)}&object=true`, { accept: 'application/json', token: o.token, fetchFn: o.fetchFn });
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error('Lichess liefert eine ungültige Antwort.'); }
  const list: any[] = Array.isArray(j?.result) ? j.result : [];
  return list.filter(u => typeof u?.name === 'string').slice(0, 10)
    .map(u => (typeof u.title === 'string' && u.title ? { name: u.name, title: u.title } : { name: u.name }));
}
