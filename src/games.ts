import type { Chess } from 'chessops/chess';
import { startPos, START_KEY, playSan } from './core';
import type { State, Rep } from './db';

export interface LichessGame { id: string; white: string; black: string; moves: string[]; date: number }
export interface GameRef { id: string; color: 'white' | 'black'; ply: number; date: number; opponent: string }
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
export function checkGames(st: State, rep: Rep, user: string, games: LichessGame[]): CheckResult {
  const u = user.toLowerCase();
  const groups = new Map<string, Deviation>();
  let count = 0, clean = 0;
  for (const g of games) {
    if (g[rep].toLowerCase() !== u) continue;
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
    d.games.push({ id: g.id, color: rep, ply: i + 1, date: g.date, opponent: rep === 'white' ? g.black : g.white });
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

/** Lädt die eigenen Partien von Lichess (Nutzer aus dem Token). */
export async function fetchGames(o: { token: string; max: number; baseUrl?: string; fetchFn?: typeof fetch }): Promise<{ user: string; games: LichessGame[] }> {
  if (!o.token) throw new Error('Kein Lichess-Token eingetragen.');
  const base = (o.baseUrl ?? 'https://lichess.org').replace(/\/$/, '');
  const f = o.fetchFn ?? fetch;
  const get = async (url: string, accept: string) => {
    let res: Response;
    try { res = await f(url, { headers: { authorization: `Bearer ${o.token}`, accept, 'user-agent': 'chessbook-lokal' } }); }
    catch { throw new Error('Lichess ist nicht erreichbar. Bitte die Internetverbindung prüfen.'); }
    if (res.status === 401 || res.status === 403) throw new Error('Lichess hat den Token abgelehnt.');
    if (res.status === 429) throw new Error('Lichess bremst gerade die Anfragen. Bitte später erneut versuchen.');
    if (!res.ok) throw new Error(`Lichess antwortet mit Status ${res.status}.`);
    try { return await res.text(); } catch { throw new Error('Verbindung zu Lichess abgebrochen.'); }
  };
  const acc = await get(`${base}/api/account`, 'application/json');
  let user = '';
  try { user = String(JSON.parse(acc).username ?? ''); } catch { /* unten gemeldet */ }
  if (!user) throw new Error('Lichess liefert keinen Benutzernamen.');
  const q = `max=${o.max}&moves=true&tags=false&clocks=false&evals=false&opening=false&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence`;
  const text = await get(`${base}/api/games/user/${encodeURIComponent(user)}?${q}`, 'application/x-ndjson');
  const games: LichessGame[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j: any;
    try { j = JSON.parse(line); } catch { continue; }
    const g = parseGame(j);
    if (g) games.push(g);
  }
  return { user, games };
}
