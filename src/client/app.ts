import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { chessgroundDests } from 'chessops/compat';
import { parseSquare } from 'chessops/util';
import { fromFen, playUci, START_KEY } from '../core';
import { layout, renderGraph, miniBoard, sanHtml, keysInRect, NODE_W, NODE_H, type Layout } from './graph';
import { openMoves, markDone, weakKeys, isWeak, type TrainStat } from './train';
import { findPosition } from './search';
import type { State, Shape, Rep } from '../db';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const attr = (el: Element | null, name: string) => el?.closest(`[${name}]`)?.getAttribute(name) ?? null;

// ---------- Zustand
let rep: Rep = 'white';
let S: State, L: Layout;
let cur = START_KEY, stack: string[] = [], fwd: string[] = [], zoom = 1;
let pending: { keys: string[]; n: number } | null = null;
let marked = new Set<string>();
let promo: { from: string; to: string; color: string } | null = null;
let settingShapes = false;
// Trainingsstatistik pro eigener Stellung (erster Versuch richtig/falsch, Serie)
let stats: Record<string, TrainStat> = {};
// Training: Startstellungen, aktuelle Ausgangsstellung, Zähler, Fehler in dieser Stellung, Lösung zeigen, besuchte Stellungen (in Zugreihenfolge) und gespielte Züge der Variante,
// Variante bisher fehlerfrei, erledigte Stellungen dieser Runde, im Graphen aufgedeckte und rot markierte Stellungen, Rundenende, Timer
let tr: { weak: boolean; starts: string[]; start: string; ok: number; bad: number; miss: boolean; hint: boolean; seen: Set<string>; line: [string, string][]; clean: boolean; done: Set<string>; shown: Set<string>; red: Set<string>; round: boolean; t: number } | null = null;
const flips: Record<Rep, boolean> = { white: false, black: false };
try { Object.assign(flips, JSON.parse(localStorage.getItem('cbflip') ?? '{}')); } catch { /* ignorieren */ }
const orientation = (): Rep => (flips[rep] ? (rep === 'white' ? 'black' : 'white') : rep);

async function api(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? 'Fehler');
  return j;
}
function toast(msg: string) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  setTimeout(() => { t.hidden = true; }, 3500);
}
async function load() {
  [S, stats] = await Promise.all([api('/api/state/' + rep), api('/api/train-stats/' + rep)]);
  if (!S.positions[cur]) cur = S.root;
  stack = stack.filter(k => S.positions[k]); fwd = fwd.filter(k => S.positions[k]);
  marked = new Set([...marked].filter(k => S.positions[k]));
  L = layout(S);
}

// ---------- Navigation
const hasEdge = (a: string, b: string) => !!S.moves[a]?.some(m => m.to === b);
const prevOf = (k: string): string | undefined => { const t = stack[stack.length - 1]; return t && hasEdge(t, k) ? t : L.parent[k]; };
const nextOf = (k: string): string | undefined => { const t = fwd[fwd.length - 1]; return t && hasEdge(k, t) ? t : S.moves[k]?.[0]?.to; };
function pathTo(k: string): [string, string][] {
  const r: [string, string][] = [];
  for (let x = k; L.parent[x] !== undefined; x = L.parent[x]) r.unshift([x, S.moves[L.parent[x]].find(m => m.to === x)!.san]);
  return r;
}
function go(k: string) {
  if (k === cur) return;
  if (fwd[fwd.length - 1] === k) fwd.pop(); else fwd = [];
  stack.push(cur); cur = k; promo = null; refresh();
}
function setCur(k: string) { cur = k; promo = null; refresh(); }
function navStart() { if (cur !== S.root) { stack.push(cur); fwd = []; setCur(S.root); } }
function navBack() {
  if (cur === S.root) return;
  const t = stack[stack.length - 1];
  const p = t && hasEdge(t, cur) ? stack.pop() : L.parent[cur];
  if (p === undefined) return;
  fwd.push(cur); setCur(p);
}
function navFwd() { const c = nextOf(cur); if (!c) return; if (fwd[fwd.length - 1] === c) fwd.pop(); stack.push(cur); setCur(c); }
function navEnd() {
  let k = cur, c: string | undefined; const seen = new Set([k]);
  while ((c = nextOf(k)) && !seen.has(c)) { if (fwd[fwd.length - 1] === c) fwd.pop(); seen.add(c); stack.push(k); k = c; }
  if (k !== cur) { fwd = []; setCur(k); }
}

// ---------- Brett
const cg: Api = Chessground($('#board'), {
  coordinates: true, animation: { duration: 150 }, draggable: { showGhost: true },
  premovable: { enabled: false }, highlight: { lastMove: true, check: true },
  movable: { free: false, events: { after: (o, d) => onMove(o, d) } },
  drawable: { enabled: true, onChange: shapes => onShapes(shapes) },
});

function lastMove(): [Key, Key] | undefined {
  const p = cur === S.root ? undefined : prevOf(cur);
  const m = p === undefined ? undefined : S.moves[p]?.find(x => x.to === cur);
  return m ? [m.uci.slice(0, 2) as Key, m.uci.slice(2, 4) as Key] : undefined;
}
function syncBoard() {
  const pos = fromFen(S.positions[cur].fen), mine = !tr || pos.turn === rep;
  settingShapes = true;
  cg.set({
    fen: S.positions[cur].fen, orientation: orientation(), turnColor: pos.turn, check: pos.isCheck() ? pos.turn : false,
    lastMove: lastMove(), movable: { color: mine ? pos.turn : undefined, dests: (mine ? chessgroundDests(pos) : new Map()) as Map<Key, Key[]> },
  });
  // Im Training keine gespeicherten Pfeile (sie verraten den Zug), nach einem Fehler die Lösung
  const sh = !tr ? S.positions[cur].shapes : tr.hint ? (S.moves[cur] ?? []).map(m => ({ orig: m.uci.slice(0, 2), dest: m.uci.slice(2, 4), brush: 'green' })) : [];
  cg.setShapes(sh.map(s => ({ orig: s.orig, dest: s.dest, brush: s.brush })) as DrawShape[]);
  settingShapes = false;
}
async function onShapes(shapes: DrawShape[]) {
  if (settingShapes || tr) return;
  const out: Shape[] = shapes.map(s => ({ orig: s.orig as string, ...(s.dest && s.dest !== s.orig ? { dest: s.dest as string } : {}), brush: s.brush ?? 'green' }));
  S.positions[cur].shapes = out;
  try { await api('/api/shapes', { rep, key: cur, shapes: out }, 'PUT'); } catch (e) { toast((e as Error).message); }
}
function onMove(orig: Key, dest: Key) {
  const pos = fromFen(S.positions[cur].fen);
  const piece = pos.board.get(parseSquare(orig)!);
  if (piece?.role === 'pawn' && (dest[1] === '8' || dest[1] === '1')) { promo = { from: orig, to: dest, color: pos.turn }; drawPromo(); return; }
  void play(orig + dest);
}
async function play(uci: string) {
  if (tr) { trMove(uci); return; }
  try {
    const r = await api('/api/move', { rep, from: cur, uci });
    await load(); go(r.toKey);
  } catch (e) { toast((e as Error).message); syncBoard(); }
}
function drawPromo() {
  const el = $('#promo');
  if (!promo) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = '<div>' + ['q', 'r', 'b', 'n'].map(t => `<button data-p="${t}"><img src="pieces/${promo!.color[0]}${t.toUpperCase()}.svg" alt=""></button>`).join('') + '</div>';
}
$('#promo').onclick = e => {
  const t = e.target as HTMLElement, b = t.closest('button');
  if (b && promo) { const m = promo; promo = null; drawPromo(); void play(m.from + m.to + b.dataset.p); }
  else if (t.id === 'promo') { promo = null; drawPromo(); syncBoard(); }
};

// ---------- Zugpfad, Info, Hinweise
function drawPath() {
  const el = $('#path'), p = tr ? tr.line : pathTo(cur);
  el.classList.toggle('start', !p.length);
  if (!p.length) { el.innerHTML = '<span class="mut">Startstellung</span>'; return; }
  const mv = (k: string, san: string, side: 'w' | 'b') => `<span class="pm${k === cur ? ' on' : ''}" data-k="${k}">${sanHtml(side, san)}</span>`;
  let h = '';
  for (let i = 0; i < p.length; i += 2) h += `<span class="pr"><span class="mn">${i / 2 + 1}.</span>${mv(p[i][0], p[i][1], 'w')}${p[i + 1] ? mv(p[i + 1][0], p[i + 1][1], 'b') : ''}</span>`;
  el.innerHTML = h; el.scrollLeft = el.scrollWidth;
}
$('#path').addEventListener('click', e => { const k = attr(e.target as Element, 'data-k'); if (k) go(k); });
$('#path').addEventListener('wheel', e => {
  const el = e.currentTarget as HTMLElement;
  if (el.scrollWidth > el.clientWidth) { el.scrollLeft += e.deltaY + e.deltaX; e.preventDefault(); }
}, { passive: false });

function lichessUrl() {
  const mv = pathTo(cur).map(([, san], i) => encodeURIComponent(i % 2 ? san : `${i / 2 + 1}.${san}`));
  const col = rep === 'black' ? '?color=black' : '?color=white';
  return mv.length ? `https://lichess.org/analysis/pgn/${mv.join('_')}${col}` : `https://lichess.org/analysis${col}`;
}
function drawPending() {
  $('#pend').innerHTML = pending ? `<div class="warn">Das entfernt ${pending.n} Stellungen. <button id="yes">Löschen</button> <button id="no">Abbrechen</button></div>` : '';
}
$('#pend').onclick = e => {
  const id = (e.target as HTMLElement).id;
  if (id === 'yes' && pending) void doDelete(pending.keys);
  else if (id === 'no') { pending = null; drawPending(); }
};
async function askDelete(keys: string[]) {
  try {
    const r = await api('/api/delete', { rep, keys, dry: true });
    if (r.removed < 2) await doDelete(keys); else { pending = { keys, n: r.removed }; drawPending(); }
  } catch (e) { toast((e as Error).message); }
}
async function doDelete(keys: string[]) {
  // Fällt die aktuelle Stellung weg, zum Vorgänger eines gelöschten Zugs springen (sonst nächster erhaltener Vorfahre)
  const cand = [cur, ...keys.map(prevOf)];
  for (let x = L.parent[cur]; x !== undefined; x = L.parent[x]) cand.push(x);
  try {
    await api('/api/delete', { rep, keys }); pending = null; fwd = []; marked.clear();
    const keep = cur; await load();
    if (!S.positions[keep]) cur = cand.find(k => k !== undefined && S.positions[k]) ?? S.root;
    refresh();
  } catch (e) { toast((e as Error).message); }
}

// ---------- Graph
const G = $('#graph');
function drawGraph() {
  hidePv();
  const rv = tr && { shown: tr.shown, ok: tr.done, bad: new Set([...tr.red].filter(k => !tr!.done.has(k))) };
  G.innerHTML = renderGraph(L, S, cur, zoom, gapKeys, marked, rv || undefined, tr ? undefined : weakSet());
  focusCur();
}
// Aktuelle Stellung mittig zeigen; in der Startstellung den ersten Zug der Hauptvariante oben
function focusCur(behavior: ScrollBehavior = 'smooth') {
  const p = L.pos[cur], q = p ?? L.pos[S.moves[S.root]?.[0]?.to ?? ''];
  if (!q) { G.scrollTo({ left: 0, top: 0, behavior }); return; }
  G.scrollTo({ left: Math.max(0, (q.x + NODE_W / 2) * zoom - G.clientWidth / 2), top: Math.max(0, (q.y + NODE_H / 2) * zoom - (p ? G.clientHeight / 2 : 40)), behavior });
}
const zmid = (f: number) => zoomTo(zoom * f, G.clientWidth / 2, G.clientHeight / 2);
$('#zi').onclick = () => zmid(1.25);
$('#zo').onclick = () => zmid(0.8);
$('#zf').onclick = () => { zoomTo(Math.min(1, (G.clientWidth - 24) / L.width, (G.clientHeight - 24) / L.height), 0, 0); G.scrollTo({ left: 0, top: 0 }); };
$('#zc').onclick = () => focusCur();
function zoomTo(z: number, mx: number, my: number) {
  const sv = G.querySelector('svg'); if (!sv) return;
  z = Math.min(2.5, Math.max(0.25, z));
  const bx = (G.scrollLeft + mx) / zoom, by = (G.scrollTop + my) / zoom;
  zoom = z; sv.setAttribute('width', String(L.width * z)); sv.setAttribute('height', String(L.height * z));
  G.scrollLeft = bx * z - mx; G.scrollTop = by * z - my;
}
let pan: { x: number; y: number; l: number; t: number } | null = null, moved = false;
G.addEventListener('wheel', e => { e.preventDefault(); hidePv(); const r = G.getBoundingClientRect(); zoomTo(zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
G.addEventListener('pointerdown', e => {
  hidePv(); if (e.button) return; moved = false;
  if ((e.ctrlKey || e.metaKey) && !tr) { const p = toGraph(e.clientX, e.clientY); if (p) lasso = { x: p.x, y: p.y, sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, id: e.pointerId, hit: new Set() }; return; }
  pan = { x: e.clientX, y: e.clientY, l: G.scrollLeft, t: G.scrollTop };
});
G.addEventListener('pointermove', e => {
  if (lasso) { moveLasso(e); return; }
  if (!pan) return;
  const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
  if (!moved && Math.hypot(dx, dy) > 4) { moved = true; G.classList.add('pan'); try { G.setPointerCapture(e.pointerId); } catch { /* ignorieren */ } }
  if (moved) { G.scrollLeft = pan.l - dx; G.scrollTop = pan.t - dy; }
});
const endPan = () => { pan = null; G.classList.remove('pan'); };
G.addEventListener('pointerup', () => { if (lasso && moved) { lasso.hit.forEach(k => marked.add(k)); } endLasso(); endPan(); });
G.addEventListener('pointercancel', () => { endLasso(); endPan(); });

// Rechteck-Auswahl: Strg/Cmd+Ziehen fügt alle berührten Knoten zur Markierung hinzu, Escape bricht ab
let lasso: { x: number; y: number; sx: number; sy: number; cx: number; cy: number; id: number; hit: Set<string>; el?: SVGRectElement } | null = null;
const toGraph = (cx: number, cy: number) => { const r = G.querySelector('svg')?.getBoundingClientRect(); return r ? { x: (cx - r.left) / zoom, y: (cy - r.top) / zoom } : null; };
function moveLasso(e: PointerEvent) {
  const l = lasso!; l.cx = e.clientX; l.cy = e.clientY;
  if (!moved && Math.hypot(l.cx - l.sx, l.cy - l.sy) <= 4) return;
  if (!moved) { moved = true; G.classList.add('lasso'); try { G.setPointerCapture(l.id); } catch { /* ignorieren */ } requestAnimationFrame(lassoTick); }
  drawLasso();
}
function drawLasso() {
  const l = lasso!, sv = G.querySelector('svg'), p = toGraph(l.cx, l.cy); if (!sv || !p) return;
  if (!l.el?.isConnected) { l.el = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); l.el.setAttribute('class', 'lasso'); sv.appendChild(l.el); }
  const a = { x: Math.min(l.x, p.x), y: Math.min(l.y, p.y), width: Math.abs(p.x - l.x), height: Math.abs(p.y - l.y) };
  for (const [n, v] of Object.entries(a)) l.el.setAttribute(n, String(v));
  l.hit = new Set(keysInRect(L, l.x, l.y, p.x, p.y)); showMarks(l.hit);
}
// Am Rand von #graph scrollt die Ansicht mit
function lassoTick() {
  if (!lasso) return;
  const r = G.getBoundingClientRect(), d = (c: number, lo: number, hi: number) => c < lo + 30 ? -12 : c > hi - 30 ? 12 : 0;
  const dx = d(lasso.cx, r.left, r.right), dy = d(lasso.cy, r.top, r.bottom);
  if (dx || dy) { G.scrollLeft += dx; G.scrollTop += dy; drawLasso(); }
  requestAnimationFrame(lassoTick);
}
function endLasso() {
  if (!lasso) return;
  lasso.el?.remove(); try { G.releasePointerCapture(lasso.id); } catch { /* ignorieren */ }
  lasso = null; G.classList.remove('lasso'); showMarks();
}
addEventListener('keydown', e => { if (e.key === 'Escape' && lasso) { e.stopImmediatePropagation(); moved = true; endLasso(); } }, true);
// Strg/Cmd+Klick markiert, normaler Klick navigiert und hebt die Markierung auf
G.addEventListener('click', e => {
  if (moved) { moved = false; return; }
  const k = attr(e.target as Element, 'data-k'); if (!k || tr) return;
  if (e.ctrlKey || e.metaKey) { if (!marked.delete(k)) marked.add(k); } else marked.clear();
  showMarks(); if (!e.ctrlKey && !e.metaKey) go(k);
});
function showMarks(extra?: Set<string>) {
  G.querySelectorAll('.n').forEach(n => { const k = n.getAttribute('data-k')!; n.classList.toggle('sel', marked.has(k) || !!extra?.has(k)); });
  const n = extra ? new Set([...marked, ...extra]).size : marked.size;
  if (tr) { $('#info').innerHTML = `<b class="ok">✓ ${tr.ok}</b> <b class="bad">✗ ${tr.bad}</b>`; return; }
  $('#info').textContent =`${Object.keys(S.positions).length - 1} Stellungen` + (n ? ` · ${n} markiert` : '');
}
function clearMarks() { if (marked.size) { marked.clear(); showMarks(); } }

// Vorschau beim Darüberfahren
const PV = document.createElement('div'); PV.className = 'pv'; PV.hidden = true; document.body.appendChild(PV);
let pvKey: string | null = null;
function hidePv() { PV.hidden = true; pvKey = null; }
G.addEventListener('mousemove', e => {
  const k = pan || lasso || tr ? null : attr(e.target as Element, 'data-k');
  if (!k || !S.positions[k]) { hidePv(); return; }
  if (pvKey !== k) { pvKey = k; const st = stats[k]; PV.innerHTML = miniBoard(S.positions[k].fen, orientation() === 'black') + `<div class="t">${(L.num[k] ?? '') + (L.san[k] ?? '')}${st ? ` <b class="ok">✓ ${st.ok}</b> <b class="bad">✗ ${st.bad}</b>` : ''}</div>`; }
  let x = e.clientX + 18, y = e.clientY + 18;
  if (x + 212 > innerWidth) x = e.clientX - 222;
  if (y + 236 > innerHeight) y = e.clientY - 246;
  PV.style.left = Math.max(4, x) + 'px'; PV.style.top = Math.max(4, y) + 'px'; PV.hidden = false;
});
G.addEventListener('mouseleave', hidePv);

// Rechtsklick-Menü
// Auf einem markierten Knoten wirkt es auf alle markierten, sonst nur auf diesen
const CM = document.createElement('div'); CM.id = 'cm'; CM.hidden = true; document.body.appendChild(CM);
let cmKeys: string[] = [];
G.addEventListener('contextmenu', e => {
  e.preventDefault();
  const k = attr(e.target as Element, 'data-k');
  if (!k || tr) { CM.hidden = true; return; }
  cmKeys = marked.has(k) ? [...marked] : [k];
  const n = cmKeys.length > 1 ? cmKeys.length + ' ' : '';
  // Reihenfolge unter dem Vorgänger im Graphen (links = Hauptvariante)
  const p = L.parent[k], sib = n || p === undefined ? [] : S.moves[p], i = sib.findIndex(m => m.to === k);
  const ord = sib.length > 1 ? (i > 0 ? '<button data-act="up">Nach links</button>' : '') + (i < sib.length - 1 ? '<button data-act="down">Nach rechts</button>' : '') : '';
  const rst = cmKeys.some(x => stats[x]) ? '<button data-act="rst">Statistik zurücksetzen</button>' : '';
  CM.innerHTML = `<button data-act="train">Training ab ${n ? n + 'Stellungen' : 'hier'}</button>${ord}${rst}<button data-act="del">${n ? n + 'Züge löschen' : 'Löschen'}</button>`;
  CM.style.left = e.clientX + 'px'; CM.style.top = e.clientY + 'px'; CM.hidden = false;
});
CM.onclick = e => {
  const act = attr(e.target as Element, 'data-act'); if (!act || !cmKeys.length) return;
  CM.hidden = true;
  if (act === 'del') void askDelete(cmKeys);
  else if (act === 'train') startTrain(cmKeys);
  else if (act === 'rst') void resetStats(cmKeys);
  else void reorder(cmKeys[0], act as 'main' | 'up' | 'down');
};
async function reorder(k: string, dir: 'main' | 'up' | 'down') {
  try { await api('/api/reorder', { rep, from: L.parent[k], to: k, dir }); await load(); refresh(); } catch (e) { toast((e as Error).message); }
}
document.addEventListener('pointerdown', e => { if (!CM.contains(e.target as Node)) CM.hidden = true; }, true);

// ---------- Gesamtdarstellung
function refresh() {
  syncBoard(); drawPromo(); drawPath(); drawGraph(); drawPending();
  $('#tw').className = rep === 'white' ? 'on' : ''; $('#tb').className = rep === 'black' ? 'on' : '';
  ($('#lic') as HTMLAnchorElement).href = lichessUrl();
  showMarks();
  const atRoot = cur === S.root || !!tr, nx = !!nextOf(cur) && !tr;
  ($('#n0') as HTMLButtonElement).disabled = ($('#n1') as HTMLButtonElement).disabled = atRoot;
  ($('#n2') as HTMLButtonElement).disabled = ($('#n3') as HTMLButtonElement).disabled = !nx;
  $('#trn').classList.toggle('on', !!tr && !tr.weak);
  const nw = weakKeys(S, stats).length, wb = $('#weak');
  wb.classList.toggle('on', !!tr?.weak); wb.hidden = !nw && !tr?.weak; $('#weakn').textContent = nw ? String(nw) : '';
}
async function switchRep(r: Rep) { if (r === rep) { navStart(); return; } rep = r; cur = START_KEY; stack = []; fwd = []; pending = null; marked.clear(); await load(); await loadGapJob().catch(() => {}); refresh(); }
function flipBoard() { flips[rep] = !flips[rep]; try { localStorage.setItem('cbflip', JSON.stringify(flips)); } catch { /* ignorieren */ } refresh(); }

$('#tw').onclick = () => void switchRep('white'); $('#tb').onclick = () => void switchRep('black');
$('#n0').onclick = navStart; $('#n1').onclick = navBack; $('#n2').onclick = navFwd; $('#n3').onclick = navEnd;
$('#fl').onclick = flipBoard;
addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey || /INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName) || document.querySelector('dialog[open]')) return;
  const f: Record<string, () => void> = tr
    ? { f: flipBoard, F: flipBoard, t: toggleTrain, T: toggleTrain, w: toggleWeak, W: toggleWeak, Escape: stopTrain }
    : { f: flipBoard, F: flipBoard, t: toggleTrain, T: toggleTrain, w: toggleWeak, W: toggleWeak, '/': () => Q.focus(), ArrowLeft: navBack, ArrowRight: navFwd, ArrowUp: navStart, Home: navStart, ArrowDown: navEnd, End: navEnd };
  if (f[e.key]) { e.preventDefault(); f[e.key](); } else if (e.key === 'Escape') { CM.hidden = true; clearMarks(); }
});
addEventListener('resize', () => cg.redrawAll());
// Suche: FEN, Zugfolge oder PGN, springt zur Stellung bzw. zur letzten bekannten Stellung der Zugfolge.
// Mehrzeiliges PGN wird beim Einfügen sofort gesucht; der Originaltext bleibt erhalten, weil das Feld Zeilenumbrüche verliert.
const Q = $<HTMLInputElement>('#q');
let qRaw: { shown: string; text: string } | null = null;
function search(text: string) {
  if (tr) return;
  const r = findPosition(S, text);
  $('#qs').classList.toggle('bad', 'error' in r);
  if ('error' in r) { toast(r.error); return; }
  if (r.played < r.total) toast(`${r.played}/${r.total} Züge im Repertoire`);
  else { Q.value = ''; qRaw = null; Q.blur(); }
  go(r.key);
}
Q.addEventListener('keydown', e => {
  if (e.key === 'Escape') { Q.value = ''; qRaw = null; Q.blur(); $('#qs').classList.remove('bad'); return; }
  if (e.key === 'Enter') search(qRaw && qRaw.shown === Q.value ? qRaw.text : Q.value);
});
Q.addEventListener('paste', e => {
  const t = e.clipboardData?.getData('text') ?? '';
  if (!/[\r\n]/.test(t.trim())) return;
  e.preventDefault();
  Q.value = t.replace(/\s+/g, ' ').trim(); qRaw = { shown: Q.value, text: t };
  search(t);
});
Q.addEventListener('input', () => $('#qs').classList.remove('bad'));
// Ziehgriff: Brettbreite (Spalte links) per Maus, gespeichert; Doppelklick setzt zurück
const top = $('.top'), split = $('#split');
// Größte Spaltenbreite, bei der das Brett selbst noch ganz ins Fenster passt
function maxBw() {
  const b = $('#board').getBoundingClientRect(), c = $('.top .card').getBoundingClientRect();
  return innerHeight - (b.top + scrollY) - 12 + (c.width - b.width);
}
let bwWant: number | null = null;
const setBw = (w: number | null) => {
  bwWant = w;
  if (w === null) top.style.removeProperty('--bw');
  else top.style.setProperty('--bw', Math.round(Math.max(280, Math.min(w, top.clientWidth - 24 - 280, maxBw()))) + 'px');
  requestAnimationFrame(() => { cg.redrawAll(); if (L) focusCur('auto'); });
};
try { const w = Number(localStorage.getItem('cbbw')); if (w) setBw(w); } catch { /* ignorieren */ }
addEventListener('resize', () => { if (bwWant !== null) setBw(bwWant); });
split.addEventListener('pointerdown', e => {
  e.preventDefault(); split.setPointerCapture(e.pointerId); split.classList.add('drag'); document.body.classList.add('resizing');
  const x0 = top.getBoundingClientRect().left;
  const move = (ev: PointerEvent) => setBw(ev.clientX - x0 - 12);
  const up = () => {
    split.removeEventListener('pointermove', move); split.classList.remove('drag'); document.body.classList.remove('resizing');
    try { localStorage.setItem('cbbw', String(parseFloat(top.style.getPropertyValue('--bw')) || '')); } catch { /* ignorieren */ }
    bwWant = parseFloat(top.style.getPropertyValue('--bw')) || null;
  };
  split.addEventListener('pointermove', move); split.addEventListener('pointerup', up, { once: true });
});
split.addEventListener('dblclick', () => { setBw(null); try { localStorage.removeItem('cbbw'); } catch { /* ignorieren */ } });

// ---------- Training (Repertoire abfragen)
// Der Gegner spielt zufällig einen seiner Repertoirezüge, man selbst muss einen eigenen finden.
// Am Ende einer Variante geht es zurück zur Ausgangsstellung. Fehlerfrei gespielte Varianten kommen in dieser Runde nicht wieder,
// sind alle geschafft, beginnt eine neue Runde. Gespeichert wird pro eigener Stellung nur der erste Versuch (richtig/falsch).
// Schwachstellen-Training (W) startet ab den Stellungen mit offenen Fehlern, mit Markierung nur ab denen darin bzw. danach.
// Der Graph deckt sich dabei auf: gespielte Stellungen erscheinen, nach einem Fehler nur bis zur Fehlerstelle (rot),
// fehlerfrei geschaffte werden grün. Mit einer neuen Runde ist er wieder verdeckt (bis auf die Startstellungen).
// Mit markierten Knoten (oder per Rechtsklick) geht es ab diesen Stellungen, sonst ab der aktuellen.
function toggleTrain() { if (tr) stopTrain(); else startTrain(marked.size ? [...marked] : undefined); }
function toggleWeak() {
  if (tr) { stopTrain(); return; }
  const ks = weakKeys(S, stats, marked.size ? [...marked] : undefined);
  if (!ks.length) { toast('Keine Schwachstellen'); return; }
  startTrain(ks, true);
}
function startTrain(from?: string[], weak = false) {
  const starts = (from ?? [S.moves[cur]?.length ? cur : S.root]).filter(k => S.moves[k]?.length);
  if (!starts.length) { toast(from ? 'Ab hier keine Züge' : 'Noch keine Züge im Repertoire'); return; }
  CM.hidden = true; pending = null; promo = null;
  const start = starts.includes(cur) ? cur : starts[Math.floor(Math.random() * starts.length)];
  tr = { weak, starts, start, ok: 0, bad: 0, miss: false, hint: false, seen: new Set([start]), line: pathTo(start), clean: true, done: new Set(), shown: new Set(), red: new Set(), round: false, t: 0 };
  tr.shown = baseShown(tr.starts);
  document.body.classList.add('train');
  if (start !== cur) { stack.push(cur); fwd = []; cur = start; }
  refresh(); trStep();
}
function stopTrain() {
  if (!tr) return;
  clearTimeout(tr.t); tr = null; document.body.classList.remove('train'); refresh();
}
function trStep() {
  const t = tr; if (!t) return;
  const ms = (S.moves[cur] ?? []).filter(m => !t.seen.has(m.to));
  if (!ms.length) {
    if (t.clean) markDone(S, rep, [...t.seen], t.done);
    const all = t.round = t.starts.every(k => t.done.has(k));
    if (all) toast('Alle Varianten geschafft · neue Runde');
    flash('done'); drawGraph(); t.t = window.setTimeout(trRestart, all ? 1600 : 900); return;
  }
  if (fromFen(S.positions[cur].fen).turn !== rep) {
    const c = openMoves(S, cur, t.seen, t.done);
    t.t = window.setTimeout(() => { const m = c[Math.floor(Math.random() * c.length)]; trGo(m.to, m.san); }, 450);
  }
}
function trGo(k: string, san: string) {
  const t = tr; if (!t) return;
  t.seen.add(k); t.line.push([k, san]); if (t.clean) t.shown.add(k); t.miss = t.hint = false; go(k); trStep();
}
function trRestart() {
  const t = tr; if (!t) return;
  if (t.round) { t.round = false; t.done.clear(); t.red.clear(); t.shown = baseShown(t.starts); }
  const open = t.starts.filter(k => !t.done.has(k));
  t.start = open[Math.floor(Math.random() * open.length)] ?? t.starts[0];
  t.seen = new Set([t.start]); t.line = pathTo(t.start); t.miss = t.hint = false; t.clean = true; fwd = [];
  if (cur !== t.start) { stack.push(cur); setCur(t.start); } else refresh();
  trStep();
}
function trMove(uci: string) {
  const t = tr!, p = playUci(fromFen(S.positions[cur].fen), uci);
  const m = p && S.moves[cur]?.find(x => x.uci === p.uci);
  if (m) { if (!t.miss) { t.ok++; void record(cur, true); } flash('ok'); trGo(m.to, m.san); return; }
  if (!t.miss) { t.bad++; void record(cur, false); t.miss = true; if (t.clean) t.red.add(cur); t.clean = false; }
  t.hint = true; flash('bad'); refresh();
}
// Startstellungen samt Weg dorthin sind immer sichtbar
function baseShown(starts: string[]) { return new Set(starts.flatMap(k => [k, ...pathTo(k).map(([x]) => x)])); }
function flash(c: 'ok' | 'bad' | 'done') {
  const el = $('#bw'); el.classList.remove('ok', 'bad', 'done'); void el.offsetWidth; el.classList.add(c);
}
$('#trn').onclick = toggleTrain;
$('#weak').onclick = toggleWeak;
const weakSet = () => new Set(Object.keys(stats).filter(k => isWeak(stats[k])));
async function record(key: string, ok: boolean) {
  try { stats[key] = await api('/api/train-result', { rep, key, ok }); } catch (e) { toast((e as Error).message); }
}
async function resetStats(keys: string[]) {
  try { await api('/api/train-reset', { rep, keys }); keys.forEach(k => delete stats[k]); refresh(); } catch (e) { toast((e as Error).message); }
}

// ---------- Daten (Export und Import)
const dlg = $<HTMLDialogElement>('#dlg'), txt = $<HTMLTextAreaElement>('#txt');
function download(name: string, text: string, type: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// Importziel: bei PGN ein Repertoire, bei JSON zusätzlich beide
type Target = Rep | 'both';
const TNAME: Record<Target, string> = { white: 'Weiß', black: 'Schwarz', both: 'Beide' };
let tgt: Target = 'white', tgtJson = false;
const isJson = () => txt.value.trim().startsWith('{');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const de = (x: number) => x.toLocaleString('de-DE');
const kpi = (v: string | number, l: string) => `<div><b>${typeof v === 'number' ? de(v) : v}</b><span>${l}</span></div>`;
function renderTarget(reset = false) {
  const j = isJson(), has = !!txt.value.trim();
  if (reset || j !== tgtJson) { tgtJson = j; tgt = j ? 'both' : rep; }
  const opts: Target[] = j ? ['white', 'black', 'both'] : ['white', 'black'];
  $('#itgt').innerHTML = opts.map(v => `<button data-t="${v}"${v === tgt ? ' class="on"' : ''}>${TNAME[v]}</button>`).join('');
  const f = $('#ifmt'); f.hidden = !has; f.textContent = j ? 'JSON' : 'PGN';
  ($('#imp') as HTMLButtonElement).disabled = !has;
}
async function useFile(f: File | undefined) { if (!f) return; txt.value = await f.text(); $('#fname').textContent = f.name; $('#dm').innerHTML = ''; renderTarget(); }
$('#itgt').onclick = e => { const v = attr(e.target as Element, 'data-t') as Target | null; if (v) { tgt = v; renderTarget(); } };
txt.oninput = () => { $('#fname').textContent = ''; renderTarget(); };
$('#dat').onclick = () => { $('#dm').innerHTML = ''; renderTarget(true); dlg.showModal(); };
$('#dclose').onclick = () => dlg.close();
$('#xjson').onclick = async () => download('chessbook-export.json', JSON.stringify(await api('/api/export')), 'application/json');
$('#xw').onclick = async () => download('chessbook-weiss.pgn', await (await fetch('/api/export-pgn/white')).text(), 'text/plain');
$('#xb').onclick = async () => download('chessbook-schwarz.pgn', await (await fetch('/api/export-pgn/black')).text(), 'text/plain');
$('#fpick').onclick = () => $('#file').click();
$('#file').onchange = e => { const i = e.target as HTMLInputElement; useFile(i.files?.[0]); i.value = ''; };
const drop = $('#drop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', e => { if (!drop.contains(e.relatedTarget as Node)) drop.classList.remove('over'); });
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); useFile(e.dataTransfer?.files[0]); });
$('#imp').onclick = async () => {
  const t = txt.value.trim(), out = $('#dm'), to = tgt;
  if (!t) return;
  try {
    const r = isJson()
      ? await api('/api/import-json', { data: JSON.parse(t), reps: to === 'both' ? ['white', 'black'] : [to] })
      : await api('/api/import-pgn', { rep: to, text: t });
    out.innerHTML = `<div class="okbox"><div class="ph"><i>✓</i><div><b>Importiert: ${to === 'both' ? 'Weiß + Schwarz' : TNAME[to]}</b></div></div>
      <div class="kpis">${kpi(r.positions, 'Stellungen')}${kpi(r.moves, 'Züge')}${kpi(r.skipped, 'übersprungen')}${kpi(r.shapes, 'Pfeile/Kreise')}</div></div>`;
    out.scrollIntoView({ block: 'nearest' });
    await load(); refresh();
  } catch (e) { out.innerHTML = `<div class="note err">Fehler: ${e instanceof SyntaxError ? 'JSON fehlerhaft' : esc((e as Error).message)}</div>`; }
};

// ---------- Lücken-Erkennung (Vergleich mit den häufigsten Zügen auf Lichess)
interface GapRow { key: string; san: string; games: number; share: number; reach: number }
interface GapJob { state: 'none' | 'running' | 'done' | 'error'; queried: number; open: number; message: string; gaps: GapRow[]; own: { key: string; reach: number }[]; source: string; player: string; color: string; indexing?: { queue: number | null; games: number } | null }
interface GapCfg { tokenSet: boolean; source: 'masters' | 'lichess' | 'player'; player: string; playerColor: 'auto' | 'white' | 'black'; thresholds?: Partial<Record<GapCfg['source'], { minShare: number; minGames: number }>>; accounts?: string[] }
const gapJobs: Record<Rep, GapJob | null> = { white: null, black: null };
let gapKeys = new Set<string>(), gapCfg: GapCfg | null = null, gapTimer = 0, editToken = false;
const gdlg = $<HTMLDialogElement>('#gdlg');
const pct = (x: number) => (x * 100).toLocaleString('de-DE', { maximumFractionDigits: x < 0.1 ? 1 : 0 }) + ' %';
function pathText(k: string) {
  const p = pathTo(k).map(([, san], i) => (i % 2 ? san : `${i / 2 + 1}.${san}`));
  if (!p.length) return 'Startstellung';
  const from = Math.max(0, p.length - 10), start = from - (from % 2);
  return (start ? '… ' : '') + p.slice(start).join(' ');
}
function updateGapKeys() {
  const j = gapJobs[rep];
  gapKeys = new Set(j && j.state === 'done' ? [...j.gaps.map(g => g.key), ...j.own.map(o => o.key)] : []);
}
async function loadGapJob() { gapJobs[rep] = await api('/api/gaps/' + rep); updateGapKeys(); }
const SOURCES: [string, string, string][] = [
  ['masters', 'Masters', 'Partien von Großmeistern'],
  ['lichess', 'Lichess', 'Alle Partien auf Lichess'],
  ['player', 'Spieler', 'Partien eines Lichess-Spielers'],
];
// Token-Feld, geteilt von Lücken und Partien; das Eingabefeld wird relativ zum Button gesucht, weil beide Dialoge im DOM sind
const tokenHtml = (c: GapCfg) => c.tokenSet && !editToken
  ? `<div class="stat"><i></i>Lichess verbunden<button class="link" data-act="chtok">Ändern</button></div>`
  : `<label class="fld"><span class="lb">Lichess-Token</span><span class="inl"><input class="tok" type="password" placeholder="lip_…" autocomplete="off"><button data-act="savetok" class="primary">Speichern</button></span></label>
     <p class="hint"><a href="https://lichess.org/account/oauth/token" target="_blank" rel="noopener">Token erstellen ↗</a></p>`;
async function tokenAct(act: string | undefined, b: HTMLElement | null) {
  if (act === 'chtok') editToken = true;
  else if (act === 'savetok') { gapCfg = await api('/api/gaps-config', { lichessToken: b?.closest('.fld')?.querySelector<HTMLInputElement>('input.tok')?.value ?? '' }, 'PUT'); editToken = false; }
  else return false;
  return true;
}
function renderGapCfg() {
  const c = gapCfg; if (!c) return;
  const seg = SOURCES.map(([v, n, d]) => `<button data-src="${v}" title="${d}"${v === c.source ? ' class="on"' : ''}>${n}</button>`).join('');
  const t = c.thresholds?.[c.source] ?? { minShare: 0.05, minGames: 30 };
  const opp = rep === 'white' ? 'Schwarz' : 'Weiß';
  const sel = (v: string, n: string) => `<option value="${v}"${v === c.playerColor ? ' selected' : ''}>${n}</option>`;
  $('#ghead').innerHTML = `<h2>Lücken · ${rep === 'white' ? 'Weiß' : 'Schwarz'}</h2>`;
  $('#gcfg').innerHTML = tokenHtml(c) +
    `<div class="sec">Quelle</div><div class="seg" id="gsrc">${seg}</div>` +
    (c.source === 'player'
      ? `<div class="grid2"><label class="fld"><span class="lb">Spieler</span><input id="gplayer" type="text" value="${esc(c.player)}" placeholder="Lichess-Name" maxlength="30" autocomplete="off"></label>
         <label class="fld"><span class="lb">Farbe</span><select id="gcolor">${sel('auto', 'Gegnerseite (' + opp + ')')}${sel('white', 'Weiß')}${sel('black', 'Schwarz')}</select></label></div>`
      : '') +
    `<div class="sec">Schwellen</div>
     <div class="grid2"><label class="fld"><span class="lb">Min. Anteil</span><span class="unit"><input id="gshare" type="number" min="1" max="50" value="${Math.round(t.minShare * 100)}"><i>%</i></span></label>
       <label class="fld"><span class="lb">Min. Partien</span><input id="ggames" type="number" min="1" value="${t.minGames}"></label></div>`;
}
function renderGapRes() {
  const j = gapJobs[rep]; let h = '';
  const run = j?.state === 'running', scan = $('#gscan') as HTMLButtonElement;
  scan.disabled = !gapCfg?.tokenSet || run; scan.classList.toggle('busy', run);
  scan.innerHTML = run ? '<span class="spin s"></span>Suche läuft …' : j && j.state !== 'none' ? 'Erneut suchen' : 'Suchen';
  const prog = (title: string, k: string) => `<div class="sec"></div><div class="prog"><div class="ph"><span class="spin"></span><b>${title}</b></div><div class="kpis">${k}</div></div>`;
  if (!j || j.state === 'none') h = '';
  else if (run && j.indexing) {
    const { queue, games } = j.indexing;
    h = prog(`Lichess liest ${esc(j.player)} ein`, (queue ? kpi(queue, 'in der Warteschlange') : '') + kpi(games, 'Partien'));
  } else if (run) h = prog('Suche läuft', kpi(j.queried, 'abgefragt') + kpi(j.open, 'offen'));
  else if (j.state === 'error') h = `<div class="sec"></div><div class="note err">${esc(j.message)}</div>`;
  else {
    h = `<div class="sec"></div><div class="kpis">${kpi(j.gaps.length, 'Gegnerzüge fehlen')}${kpi(j.own.length, 'eigene Züge fehlen')}</div>`;
    const go = (k: string) => `<button class="sm" data-act="go" data-k="${k}">Hingehen</button>`;
    if (j.gaps.length) {
      h += `<div class="sec">Gegnerzüge${j.gaps.length > 100 ? ' <span>Top 100</span>' : ''}</div><div class="list">`;
      for (const g of j.gaps.slice(0, 100)) {
        const ply = pathTo(g.key).length + 1, white = ply % 2 === 1;
        h += `<div class="gap"><div class="gi"><div class="gp">${esc(pathText(g.key))}</div><div class="gm"><span class="mv">${Math.ceil(ply / 2)}${white ? '.' : '...'}${sanHtml(white ? 'w' : 'b', g.san)}</span>
          <span class="sh" title="Anteil an den Partien"><i style="width:${Math.min(100, g.share * 100).toFixed(1)}%"></i></span><span class="gs">${pct(g.share)} · ${de(g.games)} Partien · erreichbar ${pct(g.reach)}</span></div></div>
          <div class="ga">${go(g.key)}<button class="sm soft" data-act="add" data-k="${g.key}" data-san="${esc(g.san)}">Eintragen</button></div></div>`;
      }
      h += '</div>';
    }
    if (j.own.length) {
      h += `<div class="sec">Eigene Züge</div><div class="list">`;
      for (const o of j.own.slice(0, 100)) h += `<div class="gap"><div class="gi"><div class="gp">${esc(pathText(o.key))}</div><div class="gm"><span class="gs">erreichbar ${pct(o.reach)}</span></div></div><div class="ga">${go(o.key)}</div></div>`;
      h += '</div>';
    }
  }
  $('#gres').innerHTML = h;
}
function pollGaps() {
  clearTimeout(gapTimer);
  gapTimer = window.setTimeout(async () => {
    try { await loadGapJob(); renderGapRes(); if (gapJobs[rep]?.state === 'running') pollGaps(); else drawGraph(); } catch (e) { toast((e as Error).message); }
  }, 1000);
}
$('#gap').onclick = async () => {
  try { gapCfg = await api('/api/gaps-config'); await loadGapJob(); editToken = false; renderGapCfg(); renderGapRes(); gdlg.showModal(); if (gapJobs[rep]?.state === 'running') pollGaps(); } catch (e) { toast((e as Error).message); }
};
$('#gclose').onclick = () => gdlg.close();
gdlg.addEventListener('click', async e => {
  const b = (e.target as HTMLElement).closest('button'); const act = b?.dataset.act; const k = b?.dataset.k;
  try {
    if (await tokenAct(act, b)) { renderGapCfg(); renderGapRes(); }
    else if (b?.dataset.src) { gapCfg = await api('/api/gaps-config', { source: b.dataset.src }, 'PUT'); renderGapCfg(); renderGapRes(); }
    else if (b?.id === 'gscan') { gapJobs[rep] = await api('/api/gaps/scan', { rep }); updateGapKeys(); renderGapRes(); pollGaps(); }
    else if (act === 'go' && k) { gdlg.close(); go(k); }
    else if (act === 'add' && k && b?.dataset.san) {
      await api('/api/move-san', { rep, from: k, san: b.dataset.san });
      const j = gapJobs[rep]; if (j) j.gaps = j.gaps.filter(g => !(g.key === k && g.san === b.dataset.san));
      await load(); updateGapKeys(); renderGapRes(); refresh();
    }
  } catch (err) { toast((err as Error).message); }
});
gdlg.addEventListener('change', async e => {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  try {
    if (t.id === 'gshare') gapCfg = await api('/api/gaps-config', { thresholds: { [gapCfg?.source ?? 'masters']: { minShare: Number(t.value) / 100 } } }, 'PUT');
    else if (t.id === 'ggames') gapCfg = await api('/api/gaps-config', { thresholds: { [gapCfg?.source ?? 'masters']: { minGames: Number(t.value) } } }, 'PUT');
    else if (t.id === 'gplayer') gapCfg = await api('/api/gaps-config', { player: t.value.trim() }, 'PUT');
    else if (t.id === 'gcolor') gapCfg = await api('/api/gaps-config', { playerColor: t.value }, 'PUT');
  } catch (err) { toast((err as Error).message); renderGapCfg(); }
});

// ---------- Partien (Abgleich mit den eigenen Lichess-Partien)
interface GameRef { id: string; color: Rep; ply: number; date: number; opponent: string; account: string }
interface Deviation { kind: 'own' | 'opp'; key: string; san: string; uci: string; book: string[]; count: number; games: GameRef[] }
interface CheckResult { games: number; clean: number; deviations: Deviation[] }
const checks: Record<Rep, CheckResult | null> = { white: null, black: null };
const MAXES = [50, 100, 300];
let gmMax = 100, gmBusy = false, gmErr = '', gmUsers: string[] = [];
try { const m = Number(localStorage.getItem('cbgmax')); if (MAXES.includes(m)) gmMax = m; } catch { /* ignorieren */ }
const pdlg = $<HTMLDialogElement>('#pdlg');
const day = (t: number) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
function renderGmCfg() {
  $('#phead').innerHTML = `<h2>Partien · ${rep === 'white' ? 'Weiß' : 'Schwarz'}</h2>`;
  const acc = gapCfg?.accounts ?? [], ph = !acc.length && gapCfg?.tokenSet && gmUsers.length ? gmUsers[0] : 'name1, name2';
  $('#pcfg').innerHTML = (gapCfg ? tokenHtml(gapCfg) : '') +
    `<label class="fld"><span class="lb">Accounts</span><input id="pacc" type="text" value="${esc(acc.join(', '))}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false"></label>` +
    `<div class="sec">Letzte Partien</div><div class="seg" id="pmax">${MAXES.map(n => `<button data-max="${n}"${n === gmMax ? ' class="on"' : ''}>${n}</button>`).join('')}</div>`;
}
// Stellungen, die nicht (mehr) im Repertoire sind, werden ausgelassen
function renderGmRes() {
  const r = checks[rep], b = $<HTMLButtonElement>('#pchk');
  b.disabled = !(gapCfg?.tokenSet || gapCfg?.accounts?.length) || gmBusy; b.classList.toggle('busy', gmBusy);
  b.innerHTML = gmBusy ? '<span class="spin s"></span>Abgleich läuft …' : checks.white || checks.black ? 'Erneut abgleichen' : 'Abgleichen';
  let h = gmErr ? `<div class="sec"></div><div class="note err">${esc(gmErr)}</div>` : '';
  if (r) {
    const sum = (k: Deviation['kind']) => r.deviations.reduce((a, d) => a + (d.kind === k ? d.count : 0), 0);
    h += `<div class="sec"></div><div class="kpis k4">${kpi(r.games, 'Partien')}${kpi(r.clean, 'ohne Abweichung')}${kpi(sum('own'), 'du weichst ab')}${kpi(sum('opp'), 'Gegner weicht ab')}</div>`;
    for (const [kind, title] of [['own', 'Deine Abweichungen'], ['opp', 'Gegnerzüge']] as const) {
      const ds = r.deviations.filter(d => d.kind === kind && S.positions[d.key]);
      if (!ds.length) continue;
      h += `<div class="sec">${title}${ds.length > 100 ? ' <span>Top 100</span>' : ''}</div><div class="list">`;
      for (const d of ds.slice(0, 100)) {
        const ply = pathTo(d.key).length + 1, side = ply % 2 ? 'w' : 'b', g = d.games[0];
        const num = `${Math.ceil(ply / 2)}${side === 'w' ? '.' : '...'}`;
        const multi = gmUsers.length > 1;
        const opps = [...new Set(d.games.map(x => multi ? `${x.opponent} (${x.account})` : x.opponent))].join(', ');
        const book = kind === 'own' && d.book.length ? `<span class="bk">statt ${d.book.map(s => sanHtml(side, s)).join(', ')}</span>` : '';
        const link = g ? `<a class="btn sm" href="https://lichess.org/${encodeURIComponent(g.id)}/${g.color === 'black' ? 'black' : 'white'}#${Number(g.ply) || 0}" target="_blank" rel="noopener" title="${esc(g.opponent)}">↗</a>` : '';
        h += `<div class="gap"><div class="gi"><div class="gp">${esc(pathText(d.key))}</div><div class="gm"><span class="mv">${num}${sanHtml(side, d.san)}</span>${book}
          <span class="gs" title="${esc(opps)}">${de(d.count)}×${g ? ' · ' + day(g.date) + (multi ? ' · ' + esc(g.account) : '') : ''}</span></div></div>
          <div class="ga"><button class="sm" data-act="go" data-k="${esc(d.key)}">Hingehen</button>${kind === 'opp' ? `<button class="sm soft" data-act="add" data-k="${esc(d.key)}" data-san="${esc(d.san)}">Eintragen</button>` : ''}${link}</div></div>`;
      }
      h += '</div>';
    }
  }
  $('#pres').innerHTML = h;
}
$('#gms').onclick = async () => {
  try { gapCfg = await api('/api/gaps-config'); editToken = false; gmErr = ''; renderGmCfg(); renderGmRes(); pdlg.showModal(); } catch (e) { toast((e as Error).message); }
};
$('#pclose').onclick = () => pdlg.close();
pdlg.addEventListener('change', async e => {
  const t = e.target as HTMLInputElement;
  if (t.id !== 'pacc') return;
  try { gapCfg = await api('/api/gaps-config', { accounts: t.value }, 'PUT'); }
  catch (err) { toast((err as Error).message); }
  renderGmCfg(); renderGmRes();
});
pdlg.addEventListener('click', async e => {
  const b = (e.target as HTMLElement).closest('button'); const act = b?.dataset.act; const k = b?.dataset.k;
  try {
    if (await tokenAct(act, b)) { renderGmCfg(); renderGmRes(); }
    else if (b?.dataset.max) { gmMax = Number(b.dataset.max); try { localStorage.setItem('cbgmax', String(gmMax)); } catch { /* ignorieren */ } renderGmCfg(); }
    else if (b?.id === 'pchk') {
      gmBusy = true; gmErr = ''; renderGmRes();
      try { const r = await api('/api/games/check', { max: gmMax }); checks.white = r.white; checks.black = r.black; gmUsers = r.users ?? []; } catch (err) { gmErr = (err as Error).message; } finally { gmBusy = false; }
      renderGmRes();
    }
    else if (act === 'go' && k) { pdlg.close(); go(k); }
    else if (act === 'add' && k && b?.dataset.san) {
      const san = b.dataset.san;
      await api('/api/move-san', { rep, from: k, san });
      const r = checks[rep]; if (r) r.deviations = r.deviations.filter(d => !(d.kind === 'opp' && d.key === k && d.san === san));
      await load(); renderGmRes(); refresh();
    }
  } catch (err) { toast((err as Error).message); }
});

// ---------- Hell/Dunkel
const ICO = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const SUN = ICO + '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = ICO + '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
let theme: string | null = null;
try { theme = localStorage.getItem('cbtheme'); } catch { /* ignorieren */ }
if (theme !== 'light' && theme !== 'dark') theme = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
const applyTheme = (t: string) => { theme = t; document.documentElement.setAttribute('data-theme', t); $('#th').innerHTML = t === 'dark' ? SUN : MOON; };
$('#th').onclick = () => { applyTheme(theme === 'dark' ? 'light' : 'dark'); try { localStorage.setItem('cbtheme', theme!); } catch { /* ignorieren */ } };
applyTheme(theme);

load().then(() => loadGapJob().catch(() => {})).then(refresh).catch(e => toast('Server nicht erreichbar: ' + (e as Error).message));
