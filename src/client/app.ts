import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { chessgroundDests } from 'chessops/compat';
import { parseSquare } from 'chessops/util';
import { fromFen, START_KEY } from '../core';
import { layout, renderGraph, miniBoard, sanHtml, type Layout } from './graph';
import type { State, Shape, Rep } from '../db';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const attr = (el: Element | null, name: string) => el?.closest(`[${name}]`)?.getAttribute(name) ?? null;

// ---------- Zustand
let rep: Rep = 'white';
let S: State, L: Layout;
let cur = START_KEY, stack: string[] = [], fwd: string[] = [], zoom = 1;
let pending: { key: string; n: number } | null = null;
let promo: { from: string; to: string; color: string } | null = null;
let settingShapes = false;
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
  S = await api('/api/state/' + rep);
  if (!S.positions[cur]) cur = S.root;
  stack = stack.filter(k => S.positions[k]); fwd = fwd.filter(k => S.positions[k]);
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
  const pos = fromFen(S.positions[cur].fen);
  settingShapes = true;
  cg.set({
    fen: S.positions[cur].fen, orientation: orientation(), turnColor: pos.turn, check: pos.isCheck() ? pos.turn : false,
    lastMove: lastMove(), movable: { color: pos.turn, dests: chessgroundDests(pos) as Map<Key, Key[]> },
  });
  cg.setShapes(S.positions[cur].shapes.map(s => ({ orig: s.orig, dest: s.dest, brush: s.brush })) as DrawShape[]);
  settingShapes = false;
}
async function onShapes(shapes: DrawShape[]) {
  if (settingShapes) return;
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
  const el = $('#path'), p = pathTo(cur);
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
  if (id === 'yes' && pending) void doDelete(pending.key);
  else if (id === 'no') { pending = null; drawPending(); }
};
async function askDelete(key: string) {
  try {
    const r = await api('/api/delete', { rep, key, dry: true });
    if (r.removed < 2) await doDelete(key); else { pending = { key, n: r.removed }; drawPending(); }
  } catch (e) { toast((e as Error).message); }
}
async function doDelete(key: string) {
  try { await api('/api/delete', { rep, key }); pending = null; fwd = []; await load(); refresh(); } catch (e) { toast((e as Error).message); }
}

// ---------- Graph
const G = $('#graph');
function drawGraph() {
  hidePv();
  G.innerHTML = renderGraph(L, S, cur, zoom, gapKeys);
  const p = L.pos[cur];
  G.scrollTo(p ? { left: Math.max(0, (p.x + 62) * zoom - G.clientWidth / 2), top: Math.max(0, (p.y + 15) * zoom - G.clientHeight / 2), behavior: 'smooth' } : { left: 0, top: 0, behavior: 'smooth' });
}
function zoomTo(z: number, mx: number, my: number) {
  const sv = G.querySelector('svg'); if (!sv) return;
  z = Math.min(2.5, Math.max(0.25, z));
  const bx = (G.scrollLeft + mx) / zoom, by = (G.scrollTop + my) / zoom;
  zoom = z; sv.setAttribute('width', String(L.width * z)); sv.setAttribute('height', String(L.height * z));
  G.scrollLeft = bx * z - mx; G.scrollTop = by * z - my;
}
let pan: { x: number; y: number; l: number; t: number } | null = null, moved = false;
G.addEventListener('wheel', e => { e.preventDefault(); hidePv(); const r = G.getBoundingClientRect(); zoomTo(zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
G.addEventListener('pointerdown', e => { hidePv(); if (e.button) return; pan = { x: e.clientX, y: e.clientY, l: G.scrollLeft, t: G.scrollTop }; moved = false; });
G.addEventListener('pointermove', e => {
  if (!pan) return;
  const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
  if (!moved && Math.hypot(dx, dy) > 4) { moved = true; G.classList.add('pan'); try { G.setPointerCapture(e.pointerId); } catch { /* ignorieren */ } }
  if (moved) { G.scrollLeft = pan.l - dx; G.scrollTop = pan.t - dy; }
});
const endPan = () => { pan = null; G.classList.remove('pan'); };
G.addEventListener('pointerup', endPan); G.addEventListener('pointercancel', endPan);
G.addEventListener('click', e => { if (moved) { moved = false; return; } const k = attr(e.target as Element, 'data-k'); if (k) go(k); });

// Vorschau beim Darüberfahren
const PV = document.createElement('div'); PV.className = 'pv'; PV.hidden = true; document.body.appendChild(PV);
let pvKey: string | null = null;
function hidePv() { PV.hidden = true; pvKey = null; }
G.addEventListener('mousemove', e => {
  const k = pan ? null : attr(e.target as Element, 'data-k');
  if (!k || !S.positions[k]) { hidePv(); return; }
  if (pvKey !== k) { pvKey = k; PV.innerHTML = miniBoard(S.positions[k].fen, orientation() === 'black') + `<div class="t">${L.label[k] ?? ''}</div>`; }
  let x = e.clientX + 18, y = e.clientY + 18;
  if (x + 212 > innerWidth) x = e.clientX - 222;
  if (y + 236 > innerHeight) y = e.clientY - 246;
  PV.style.left = Math.max(4, x) + 'px'; PV.style.top = Math.max(4, y) + 'px'; PV.hidden = false;
});
G.addEventListener('mouseleave', hidePv);

// Rechtsklick-Menü
const CM = document.createElement('div'); CM.id = 'cm'; CM.hidden = true; CM.innerHTML = '<button>Löschen</button>'; document.body.appendChild(CM);
let cmKey: string | null = null;
G.addEventListener('contextmenu', e => {
  e.preventDefault();
  const k = attr(e.target as Element, 'data-k');
  if (!k) { CM.hidden = true; return; }
  cmKey = k; CM.style.left = e.clientX + 'px'; CM.style.top = e.clientY + 'px'; CM.hidden = false;
});
CM.onclick = () => { CM.hidden = true; if (cmKey) void askDelete(cmKey); };
document.addEventListener('pointerdown', e => { if (!CM.contains(e.target as Node)) CM.hidden = true; }, true);

// ---------- Gesamtdarstellung
function refresh() {
  syncBoard(); drawPromo(); drawPath(); drawGraph(); drawPending();
  $('#tw').className = rep === 'white' ? 'on' : ''; $('#tb').className = rep === 'black' ? 'on' : '';
  ($('#lic') as HTMLAnchorElement).href = lichessUrl();
  $('#info').textContent = `${Object.keys(S.positions).length - 1} Stellungen`;
  const atRoot = cur === S.root, nx = !!nextOf(cur);
  ($('#n0') as HTMLButtonElement).disabled = ($('#n1') as HTMLButtonElement).disabled = atRoot;
  ($('#n2') as HTMLButtonElement).disabled = ($('#n3') as HTMLButtonElement).disabled = !nx;
}
async function switchRep(r: Rep) { if (r === rep) { navStart(); return; } rep = r; cur = START_KEY; stack = []; fwd = []; pending = null; await load(); await loadGapJob().catch(() => {}); refresh(); }
function flipBoard() { flips[rep] = !flips[rep]; try { localStorage.setItem('cbflip', JSON.stringify(flips)); } catch { /* ignorieren */ } refresh(); }

$('#tw').onclick = () => void switchRep('white'); $('#tb').onclick = () => void switchRep('black');
$('#n0').onclick = navStart; $('#n1').onclick = navBack; $('#n2').onclick = navFwd; $('#n3').onclick = navEnd;
$('#fl').onclick = flipBoard;
addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey || /INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName) || ($('#dlg') as HTMLDialogElement).open) return;
  const f: Record<string, () => void> = { f: flipBoard, F: flipBoard, ArrowLeft: navBack, ArrowRight: navFwd, ArrowUp: navStart, Home: navStart, ArrowDown: navEnd, End: navEnd };
  if (f[e.key]) { e.preventDefault(); f[e.key](); } else if (e.key === 'Escape') CM.hidden = true;
});
addEventListener('resize', () => cg.redrawAll());

// ---------- Daten (Export und Import)
const dlg = $<HTMLDialogElement>('#dlg'), txt = $<HTMLTextAreaElement>('#txt');
function download(name: string, text: string, type: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#dat').onclick = () => { $('#dm').textContent = ''; $('#target').textContent = rep === 'white' ? 'Weiß' : 'Schwarz'; dlg.showModal(); };
$('#dclose').onclick = () => dlg.close();
$('#xjson').onclick = async () => download('chessbook-export.json', JSON.stringify(await api('/api/export')), 'application/json');
$('#xw').onclick = async () => download('chessbook-weiss.pgn', await (await fetch('/api/export-pgn/white')).text(), 'text/plain');
$('#xb').onclick = async () => download('chessbook-schwarz.pgn', await (await fetch('/api/export-pgn/black')).text(), 'text/plain');
$('#file').onchange = async e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) txt.value = await f.text(); };
$('#imp').onclick = async () => {
  const t = txt.value.trim(), out = $('#dm');
  if (!t) { out.textContent = 'Bitte Text einfügen oder eine Datei wählen.'; return; }
  try {
    const r = t.startsWith('{') ? await api('/api/import-json', JSON.parse(t)) : await api('/api/import-pgn', { rep, text: t });
    out.textContent = `Fertig. Neue Stellungen: ${r.positions}, neue Züge: ${r.moves}, übersprungen: ${r.skipped}, Pfeile und Kreise: ${r.shapes}.`;
    await load(); refresh();
  } catch (e) { out.textContent = 'Fehler: ' + (e as Error).message; }
};

// ---------- Lücken-Erkennung (Vergleich mit den häufigsten Zügen auf Lichess)
interface GapRow { key: string; san: string; games: number; share: number; reach: number }
interface GapJob { state: 'none' | 'running' | 'done' | 'error'; queried: number; open: number; message: string; gaps: GapRow[]; own: { key: string; reach: number }[]; source: string; player: string; color: string }
interface GapCfg { tokenSet: boolean; source: 'masters' | 'lichess' | 'player'; player: string; playerColor: 'auto' | 'white' | 'black'; minShare: number; minGames: number }
const gapJobs: Record<Rep, GapJob | null> = { white: null, black: null };
let gapKeys = new Set<string>(), gapCfg: GapCfg | null = null, gapTimer = 0, editToken = false;
const gdlg = $<HTMLDialogElement>('#gdlg');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
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
  ['masters', 'Masters', 'Partien von Großmeistern (Masters-Datenbank von Lichess).'],
  ['lichess', 'Lichess', 'Partien aller Spieler auf Lichess.'],
  ['player', 'Spieler', 'Partien eines bestimmten Lichess-Spielers, zum Beispiel zur Vorbereitung auf einen Gegner. Beim ersten Mal muss Lichess die Partien des Spielers erst einlesen, das kann dauern.'],
];
function renderGapCfg() {
  const c = gapCfg; if (!c) return;
  const seg = SOURCES.map(([v, n]) => `<button data-src="${v}"${v === c.source ? ' class="on"' : ''}>${n}</button>`).join('');
  const desc = SOURCES.find(([v]) => v === c.source)?.[2] ?? '';
  const opp = rep === 'white' ? 'mit Schwarz' : 'mit Weiß';
  const sel = (v: string, n: string) => `<option value="${v}"${v === c.playerColor ? ' selected' : ''}>${n}</option>`;
  $('#gcfg').innerHTML = `<h2>Lücken-Erkennung: ${rep === 'white' ? 'Weiß' : 'Schwarz'}</h2>
    <p class="mut">Vergleicht dein Repertoire mit den häufigsten Zügen der gewählten Quelle und zeigt, welche Gegnerzüge dir noch fehlen. Die Ergebnisse sind nach der Wahrscheinlichkeit sortiert, mit der du die Stellung erreichst.</p>` +
    (c.tokenSet && !editToken
      ? `<p>Zugangsschlüssel gespeichert. <button data-act="chtok">Ändern</button></p>`
      : `<div class="row"><input id="gtoken" type="password" placeholder="Lichess-Zugangsschlüssel" autocomplete="off"><button data-act="savetok" class="primary">Speichern</button></div>
         <p class="mut">Lichess verlangt für diese Daten einen kostenlosen Zugangsschlüssel (Token): <a href="https://lichess.org/account/oauth/token" target="_blank" rel="noopener">lichess.org/account/oauth/token</a> öffnen, einen neuen Token ohne zusätzliche Rechte erstellen und hier einfügen. Er wird nur auf deinem Rechner in <code>data/config.json</code> gespeichert.</p>`) +
    `<div class="row"><div class="seg" id="gsrc">${seg}</div></div><p class="mut">${desc}</p>` +
    (c.source === 'player'
      ? `<div class="row"><label>Name <input id="gplayer" type="text" value="${esc(c.player)}" placeholder="Lichess-Name" maxlength="30" autocomplete="off"></label>
         <label>Partien <select id="gcolor">${sel('auto', 'Seite des Gegners (' + opp + ')')}${sel('white', 'mit Weiß')}${sel('black', 'mit Schwarz')}</select></label></div>`
      : '') +
    `<div class="row"><label>Mindestanteil <input id="gshare" type="number" min="1" max="50" value="${Math.round(c.minShare * 100)}"> %</label>
       <label>Mindestanzahl Partien <input id="ggames" type="number" min="1" value="${c.minGames}"></label></div>
     <div class="row"><button id="gscan" class="primary"${c.tokenSet ? '' : ' disabled'}>Suchen</button></div>`;
}
function renderGapRes() {
  const j = gapJobs[rep]; let h = '';
  const scan = $('#gscan') as HTMLButtonElement | null; if (scan) scan.disabled = !gapCfg?.tokenSet || j?.state === 'running';
  if (!j || j.state === 'none') h = '<p class="mut">Noch keine Suche in diesem Repertoire gestartet.</p>';
  else if (j.state === 'running') h = `<p>Suche läuft … ${j.queried} Stellungen abgefragt, ${j.open} warten. Die erste Suche braucht wegen der Pausen zwischen den Anfragen einige Minuten, spätere gehen schnell.</p>`;
  else if (j.state === 'error') h = `<p class="err">${esc(j.message)}</p>`;
  else {
    const n = (k: number, one: string, many: string) => `<b>${k}</b> ${k === 1 ? one : many}`;
    const src = j.source === 'masters' ? 'Masters' : j.source === 'player' ? `Spieler ${esc(j.player)} (${j.color === 'white' ? 'mit Weiß' : 'mit Schwarz'})` : 'Lichess';
    h = `<p>${n(j.gaps.length, 'fehlender Gegnerzug', 'fehlende Gegnerzüge')}, ${n(j.own.length, 'Stellung ohne eigenen Zug', 'Stellungen ohne eigenen Zug')}. <span class="mut">Quelle: ${src}</span></p>`;
    for (const g of j.gaps.slice(0, 100)) {
      const ply = pathTo(g.key).length + 1, white = ply % 2 === 1;
      h += `<div class="gap"><div class="gi"><div class="gp">${esc(pathText(g.key))}</div><div><b>${Math.ceil(ply / 2)}${white ? '.' : '...'}${sanHtml(white ? 'w' : 'b', g.san)}</b> in ${pct(g.share)} der Partien (${g.games.toLocaleString('de-DE')}) · erreichbar zu ${pct(g.reach)}</div></div>
        <div class="ga"><button data-act="go" data-k="${g.key}">Hingehen</button><button data-act="add" data-k="${g.key}" data-san="${esc(g.san)}">Eintragen</button></div></div>`;
    }
    if (j.gaps.length > 100) h += `<p class="mut">Es werden die 100 wichtigsten angezeigt.</p>`;
    if (j.own.length) {
      h += `<h3>Hier bist du am Zug, aber es fehlt noch dein Zug</h3>`;
      for (const o of j.own.slice(0, 100)) h += `<div class="gap"><div class="gi"><div class="gp">${esc(pathText(o.key))}</div><div>erreichbar zu ${pct(o.reach)}</div></div><div class="ga"><button data-act="go" data-k="${o.key}">Hingehen</button></div></div>`;
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
    if (act === 'chtok') { editToken = true; renderGapCfg(); renderGapRes(); }
    else if (act === 'savetok') { gapCfg = await api('/api/gaps-config', { lichessToken: ($('#gtoken') as HTMLInputElement).value }, 'PUT'); editToken = false; renderGapCfg(); renderGapRes(); }
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
    if (t.id === 'gshare') gapCfg = await api('/api/gaps-config', { minShare: Number(t.value) / 100 }, 'PUT');
    else if (t.id === 'ggames') gapCfg = await api('/api/gaps-config', { minGames: Number(t.value) }, 'PUT');
    else if (t.id === 'gplayer') gapCfg = await api('/api/gaps-config', { player: t.value.trim() }, 'PUT');
    else if (t.id === 'gcolor') gapCfg = await api('/api/gaps-config', { playerColor: t.value }, 'PUT');
  } catch (err) { toast((err as Error).message); renderGapCfg(); }
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
