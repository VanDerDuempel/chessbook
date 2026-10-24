import { parseFen } from 'chessops/fen';
import type { State } from '../db';

export const NODE_W = 124, NODE_H = 30, GAP_X = 134, GAP_Y = 58;

export interface Layout {
  pos: Record<string, { x: number; y: number }>;
  num: Record<string, string>;
  san: Record<string, string>;
  side: Record<string, 'w' | 'b'>;
  parent: Record<string, string>;
  incoming: Record<string, number>;
  width: number;
  height: number;
}

/** Baum-Layout über den Spannbaum des Graphen: jede Stellung steht unter dem Vorgänger, über den sie zuerst erreicht wurde. Die Startstellung wird nicht gezeichnet. */
export function layout(st: State): Layout {
  const depth: Record<string, number> = { [st.root]: 0 };
  const L: Layout = { pos: {}, num: {}, san: {}, side: {}, parent: {}, incoming: {}, width: 0, height: 0 };
  const kids: Record<string, string[]> = {};
  let frontier = [st.root];
  while (frontier.length) {
    const next: string[] = [];
    for (const k of frontier) for (const m of st.moves[k] ?? []) {
      if (m.to in depth) continue;
      const d = depth[k] + 1;
      depth[m.to] = d; L.parent[m.to] = k; (kids[k] ??= []).push(m.to);
      const white = d % 2 === 1;
      L.num[m.to] = `${Math.ceil(d / 2)}${white ? '.' : '...'}`;
      L.san[m.to] = m.san;
      L.side[m.to] = white ? 'w' : 'b';
      next.push(m.to);
    }
    frontier = next;
  }
  let slot = 0, maxX = 0, maxD = 0;
  const place = (k: string) => {
    const cs = kids[k] ?? [];
    let x: number;
    if (!cs.length) x = 10 + slot++ * GAP_X;
    else { cs.forEach(place); x = (L.pos[cs[0]].x + L.pos[cs[cs.length - 1]].x) / 2; }
    L.pos[k] = { x, y: 4 + (depth[k] - 1) * GAP_Y };
    maxX = Math.max(maxX, x); maxD = Math.max(maxD, depth[k]);
  };
  (kids[st.root] ?? []).forEach(place);
  const parents: Record<string, Set<string>> = {};
  for (const k of Object.keys(L.pos)) for (const m of st.moves[k] ?? []) if (L.pos[m.to]) (parents[m.to] ??= new Set()).add(k);
  for (const [k, s] of Object.entries(parents)) L.incoming[k] = s.size;
  L.width = maxX + NODE_W + 20;
  L.height = maxD * GAP_Y + 4;
  return L;
}

/** Knoten, die das Rechteck (Graph-Koordinaten, Ecken beliebig) berühren oder darin liegen. */
export function keysInRect(L: Layout, x0: number, y0: number, x1: number, y1: number): string[] {
  const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), b = Math.max(y0, y1);
  return Object.keys(L.pos).filter(k => { const p = L.pos[k]; return p.x <= r && p.x + NODE_W >= l && p.y <= b && p.y + NODE_H >= t; });
}

/** Figurinen-Notation: statt des Buchstabens (N, B, R, Q, K) steht das Figurensymbol vor dem Zielfeld. */
export function sanHtml(side: 'w' | 'b', san: string): string {
  const m = /^([KQRBN])(.*)$/.exec(san);
  return m ? `<img src="pieces/${side}${m[1]}.svg" alt="${m[1]}">${m[2]}` : san;
}

/** Punkt am rechten Rand eines Knotens: zur Stellung gibt es eine Notiz. */
export const noteDot = (L: Layout, k: string) => `<circle class="nd" cx="${L.pos[k].x + NODE_W - 9}" cy="${L.pos[k].y + NODE_H / 2}" r="3.5"/>`;

/** Training: nur aufgedeckte Stellungen zeigen, geschaffte grün, Fehlerstellen rot (rot hat Vorrang). */
export interface Reveal { shown: Set<string>; ok: Set<string>; bad: Set<string> }

export function renderGraph(L: Layout, st: State, cur: string, zoom: number, gaps?: Set<string>, marked?: Set<string>, rv?: Reveal): string {
  if (!Object.keys(L.pos).length) return '<div class="empty">Noch keine Züge</div>';
  const pathEdges = new Set<string>(), pathNodes = new Set<string>();
  for (let x = cur; L.parent[x] !== undefined; x = L.parent[x]) { pathEdges.add(L.parent[x] + '>' + x); pathNodes.add(x); }
  let normal = '', onPath = '', hot = '';
  for (const k of Object.keys(L.pos)) for (const m of st.moves[k] ?? []) {
    const a = L.pos[k], z = L.pos[m.to];
    if (!z || (rv && !(rv.shown.has(k) && rv.shown.has(m.to)))) continue;
    const up = m.to === cur, dn = k === cur, pt = pathEdges.has(k + '>' + m.to);
    const my = (a.y + NODE_H + z.y) / 2, cx = NODE_W / 2;
    const e = `<path class="e${up ? ' up' : dn ? ' dn' : pt ? ' path' : ''}" d="M${a.x + cx} ${a.y + NODE_H}C${a.x + cx} ${my} ${z.x + cx} ${my} ${z.x + cx} ${z.y}"/>`;
    if (up || dn) hot += e; else if (pt) onPath += e; else normal += e;
  }
  let nodes = '';
  for (const [k, p] of Object.entries(L.pos)) {
    if (rv && !rv.shown.has(k)) continue;
    const tr = rv ? (rv.bad.has(k) ? ' tbad' : rv.ok.has(k) ? ' tok' : '') : '';
    const cls = `n ${L.side[k]}${k === cur ? ' cur' : pathNodes.has(k) ? ' onpath' : ''}${marked?.has(k) ? ' sel' : ''}${gaps?.has(k) ? ' gp' : ''}${tr}`;
    const inc = L.incoming[k] ?? 0;
    nodes += `<g class="${cls}" data-k="${k}"><rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="8"/><circle class="sd" cx="${p.x + 12}" cy="${p.y + NODE_H / 2}" r="4"/>` +
      `<foreignObject x="${p.x + 21}" y="${p.y + 2}" width="${NODE_W - 26}" height="${NODE_H - 4}"><div class="lab"><span class="mn">${L.num[k]}</span>${sanHtml(L.side[k], L.san[k])}</div></foreignObject>` +
      (!rv && st.positions[k]?.note ? noteDot(L, k) : '') +
      (gaps?.has(k) ? `<circle class="gapdot" cx="${p.x + 6}" cy="${p.y + 2}" r="5"><title>Lücke</title></circle>` : '') +
      (inc > 1 ? `<title>Zugumstellung: ${inc} Wege</title><circle class="badge" cx="${p.x + NODE_W - 6}" cy="${p.y + 2}" r="8"/><text class="bt" x="${p.x + NODE_W - 6}" y="${p.y + 5.5}">${inc}</text>` : '') + '</g>';
  }
  return `<svg width="${L.width * zoom}" height="${L.height * zoom}" viewBox="0 0 ${L.width} ${L.height}">${normal}${onPath}${hot}${nodes}</svg>`;
}

const ROLE: Record<string, string> = { pawn: 'P', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K' };

/** Kleines Brett für die Vorschau beim Darüberfahren. */
export function miniBoard(fen: string, flip: boolean): string {
  const board = parseFen(fen).unwrap().board;
  let h = '';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const rank = flip ? r : 7 - r, file = flip ? 7 - c : c;
    const p = board.get(file + rank * 8);
    h += `<i class="${(file + rank) % 2 ? 'l' : 'd'}">${p ? `<img src="pieces/${p.color[0]}${ROLE[p.role]}.svg" alt="">` : ''}</i>`;
  }
  return `<div class="mb">${h}</div>`;
}
