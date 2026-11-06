import type { State, Rep } from './db';
import type { ExplorerData, ExplorerProgress } from './explorer';

export interface GapOptions { minShare: number; minGames: number; minReach: number }
export interface Gap { key: string; san: string; uci: string; games: number; share: number; reach: number; score: number }
export interface OwnGap { key: string; reach: number }
export interface ScanResult { gaps: Gap[]; own: OwnGap[]; queried: number }
/** Suchlauf, wie ihn /api/gaps/:rep liefert. indexing: Lichess liest den Spieler gerade ein (Warteschlange, bisher gezählte Partien), sonst null */
export interface GapJob { state: 'none' | 'running' | 'done' | 'error'; queried: number; open: number; message: string; gaps: Gap[]; own: OwnGap[]; source: string; player: string; color: string; indexing: ExplorerProgress | null }

/**
 * Sucht Lücken: Stellungen, in denen der Gegner am Zug ist und häufig gespielte Züge im Repertoire fehlen,
 * sowie Stellungen, in denen du am Zug bist, aber noch kein eigener Zug hinterlegt ist.
 * "reach" ist die Wahrscheinlichkeit, die Stellung über dein Repertoire zu erreichen (Produkt der Gegnerzug-Anteile
 * auf dem besten Weg). Stellungen unterhalb von minReach werden nicht abgefragt. minShare/minGames sind die Schwellen der aktiven Quelle.
 */
export async function scanGaps(
  st: State, rep: Rep,
  getData: (key: string, fen: string) => Promise<ExplorerData | null>,
  opt: GapOptions, onProgress?: (queried: number, open: number) => void,
): Promise<ScanResult> {
  const open = new Map<string, number>([[st.root, 1]]), done = new Set<string>(), best: Record<string, number> = { [st.root]: 1 };
  const gaps: Gap[] = [], own: OwnGap[] = [];
  let queried = 0;
  const relax = (to: string, r: number) => { if (r >= opt.minReach && !done.has(to) && r > (best[to] ?? 0)) { best[to] = r; open.set(to, r); } };
  while (open.size) {
    let key = '', reach = -1;
    for (const [k, r] of open) if (r > reach) { key = k; reach = r; }
    open.delete(key); done.add(key);
    const edges = st.moves[key] ?? [];
    const opponentToMove = (rep === 'white') === (key.split(' ')[1] === 'b');
    if (!opponentToMove) {
      if (!edges.length) own.push({ key, reach });
      for (const e of edges) relax(e.to, reach);
      continue;
    }
    const data = await getData(key, st.positions[key].fen);
    queried++;
    onProgress?.(queried, open.size);
    if (!data || data.games < opt.minGames) continue;
    const bySan = new Map(data.moves.map(m => [m.san, m]));
    for (const e of edges) { const m = bySan.get(e.san); if (m) relax(e.to, reach * m.games / data.games); }
    const have = new Set(edges.map(e => e.san));
    for (const m of data.moves) {
      const share = m.games / data.games;
      if (!have.has(m.san) && share >= opt.minShare && m.games >= opt.minGames)
        gaps.push({ key, san: m.san, uci: m.uci, games: m.games, share, reach, score: reach * share });
    }
  }
  gaps.sort((a, b) => b.score - a.score);
  own.sort((a, b) => b.reach - a.reach);
  return { gaps, own, queried };
}
