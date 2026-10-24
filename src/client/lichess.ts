// Lücken-Erkennung (Vergleich mit den häufigsten Zügen auf Lichess) und Abgleich mit den eigenen Lichess-Partien
import { sanHtml } from './graph';
import { pinBox, sameName } from './pinbox';
import { $, api, toast, esc, de, kpi } from './ui';
import type { State, Rep } from '../db';

/** Was die Dialoge aus app.ts brauchen; wird einmal per initLichess übergeben. */
export interface LichessCtx { rep(): Rep; S(): State; pathTo(k: string): [string, string][]; go(k: string): void; load(): Promise<void>; refresh(): void; drawGraph(): void }
let app!: LichessCtx;
export function initLichess(ctx: LichessCtx) { app = ctx; }

// ---------- Lücken
interface GapRow { key: string; san: string; games: number; share: number; reach: number }
interface GapJob { state: 'none' | 'running' | 'done' | 'error'; queried: number; open: number; message: string; gaps: GapRow[]; own: { key: string; reach: number }[]; source: string; player: string; color: string; indexing?: { queue: number | null; games: number } | null }
interface GapCfg { tokenSet: boolean; source: 'masters' | 'lichess' | 'player'; player: string; playerColor: 'auto' | 'white' | 'black'; thresholds?: Partial<Record<GapCfg['source'], { minShare: number; minGames: number }>>; accounts?: string[]; players?: string[] }
const gapJobs: Record<Rep, GapJob | null> = { white: null, black: null };
export let gapKeys = new Set<string>();
let gapCfg: GapCfg | null = null, gapTimer = 0, editToken = false;
const gdlg = $<HTMLDialogElement>('#gdlg');
const pct = (x: number) => (x * 100).toLocaleString('de-DE', { maximumFractionDigits: x < 0.1 ? 1 : 0 }) + ' %';
function pathText(k: string) {
  const p = app.pathTo(k).map(([, san], i) => (i % 2 ? san : `${i / 2 + 1}.${san}`));
  if (!p.length) return 'Startstellung';
  const from = Math.max(0, p.length - 10), start = from - (from % 2);
  return (start ? '… ' : '') + p.slice(start).join(' ');
}
function updateGapKeys() {
  const j = gapJobs[app.rep()];
  gapKeys = new Set(j && j.state === 'done' ? [...j.gaps.map(g => g.key), ...j.own.map(o => o.key)] : []);
}
export async function loadGapJob() { gapJobs[app.rep()] = await api('/api/gaps/' + app.rep()); updateGapKeys(); }
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
  const opp = app.rep() === 'white' ? 'Schwarz' : 'Weiß';
  const sel = (v: string, n: string) => `<option value="${v}"${v === c.playerColor ? ' selected' : ''}>${n}</option>`;
  $('#ghead').innerHTML = `<h2>Lücken · ${app.rep() === 'white' ? 'Weiß' : 'Schwarz'}</h2>`;
  $('#gcfg').innerHTML = tokenHtml(c) +
    `<div class="sec">Quelle</div><div class="seg" id="gsrc">${seg}</div>` +
    (c.source === 'player'
      ? `<div class="grid2 one"><div class="fld"><span class="lb">Spieler</span>${playerBox.html()}</div>
         <label class="fld"><span class="lb">Farbe</span><select id="gcolor">${sel('auto', 'Gegnerseite (' + opp + ')')}${sel('white', 'Weiß')}${sel('black', 'Schwarz')}</select></label></div>`
      : '') +
    `<div class="sec">Schwellen</div>
     <div class="grid2"><label class="fld"><span class="lb">Min. Anteil</span><span class="unit"><input id="gshare" type="number" min="1" max="50" value="${Math.round(t.minShare * 100)}"><i>%</i></span></label>
       <label class="fld"><span class="lb">Min. Partien</span><input id="ggames" type="number" min="1" value="${t.minGames}"></label></div>`;
  playerBox.render();
}
// Spieler wie im Spieler-Explorer auf Lichess: suchen, anpinnen, per Klick auswählen
const putPlayers = async (p: { players?: string[]; player?: string }) => { gapCfg = await api('/api/gaps-config', p, 'PUT'); };
const playerBox = pinBox(gdlg, {
  id: 'gpl', ph: 'Spieler suchen',
  pinned: () => gapCfg?.players ?? [], active: () => gapCfg?.player ?? '',
  pin: n => putPlayers({ players: [...(gapCfg?.players ?? []), n], player: n }),
  unpin: n => putPlayers({ players: (gapCfg?.players ?? []).filter(a => a !== n), ...(sameName(n, gapCfg?.player ?? '') ? { player: '' } : {}) }),
  select: n => putPlayers({ player: n }),
});
function renderGapRes() {
  const j = gapJobs[app.rep()]; let h = '';
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
    const goBtn = (k: string) => `<button class="sm" data-act="go" data-k="${k}">Hingehen</button>`;
    if (j.gaps.length) {
      h += `<div class="sec">Gegnerzüge${j.gaps.length > 100 ? ' <span>Top 100</span>' : ''}</div><div class="list">`;
      for (const g of j.gaps.slice(0, 100)) {
        const ply = app.pathTo(g.key).length + 1, white = ply % 2 === 1;
        h += `<div class="gap"><div class="gi"><div class="gp">${esc(pathText(g.key))}</div><div class="gm"><span class="mv">${Math.ceil(ply / 2)}${white ? '.' : '...'}${sanHtml(white ? 'w' : 'b', g.san)}</span>
          <span class="sh" title="Anteil an den Partien"><i style="width:${Math.min(100, g.share * 100).toFixed(1)}%"></i></span><span class="gs">${pct(g.share)} · ${de(g.games)} Partien · erreichbar ${pct(g.reach)}</span></div></div>
          <div class="ga">${goBtn(g.key)}<button class="sm soft" data-act="add" data-k="${g.key}" data-san="${esc(g.san)}">Eintragen</button></div></div>`;
      }
      h += '</div>';
    }
    if (j.own.length) {
      h += `<div class="sec">Eigene Züge</div><div class="list">`;
      for (const o of j.own.slice(0, 100)) h += `<div class="gap"><div class="gi"><div class="gp">${esc(pathText(o.key))}</div><div class="gm"><span class="gs">erreichbar ${pct(o.reach)}</span></div></div><div class="ga">${goBtn(o.key)}</div></div>`;
      h += '</div>';
    }
  }
  $('#gres').innerHTML = h;
}
function pollGaps() {
  clearTimeout(gapTimer);
  gapTimer = window.setTimeout(async () => {
    try { await loadGapJob(); renderGapRes(); if (gapJobs[app.rep()]?.state === 'running') pollGaps(); else app.drawGraph(); } catch (e) { toast((e as Error).message); }
  }, 1000);
}
$('#gap').onclick = async () => {
  try { gapCfg = await api('/api/gaps-config'); await loadGapJob(); editToken = false; renderGapCfg(); renderGapRes(); gdlg.showModal(); if (gapJobs[app.rep()]?.state === 'running') pollGaps(); } catch (e) { toast((e as Error).message); }
};
$('#gclose').onclick = () => gdlg.close();
gdlg.addEventListener('click', async e => {
  const b = (e.target as HTMLElement).closest('button'); const act = b?.dataset.act; const k = b?.dataset.k;
  try {
    if (await tokenAct(act, b)) { renderGapCfg(); renderGapRes(); }
    else if (b?.dataset.src) { gapCfg = await api('/api/gaps-config', { source: b.dataset.src }, 'PUT'); renderGapCfg(); renderGapRes(); }
    else if (b?.id === 'gscan') { gapJobs[app.rep()] = await api('/api/gaps/scan', { rep: app.rep() }); updateGapKeys(); renderGapRes(); pollGaps(); }
    else if (act === 'go' && k) { gdlg.close(); app.go(k); }
    else if (act === 'add' && k && b?.dataset.san) {
      await api('/api/move-san', { rep: app.rep(), from: k, san: b.dataset.san });
      const j = gapJobs[app.rep()]; if (j) j.gaps = j.gaps.filter(g => !(g.key === k && g.san === b.dataset.san));
      await app.load(); updateGapKeys(); renderGapRes(); app.refresh();
    }
  } catch (err) { toast((err as Error).message); }
});
gdlg.addEventListener('change', async e => {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  try {
    if (t.id === 'gshare') gapCfg = await api('/api/gaps-config', { thresholds: { [gapCfg?.source ?? 'masters']: { minShare: Number(t.value) / 100 } } }, 'PUT');
    else if (t.id === 'ggames') gapCfg = await api('/api/gaps-config', { thresholds: { [gapCfg?.source ?? 'masters']: { minGames: Number(t.value) } } }, 'PUT');
    else if (t.id === 'gcolor') gapCfg = await api('/api/gaps-config', { playerColor: t.value }, 'PUT');
  } catch (err) { toast((err as Error).message); renderGapCfg(); }
});

// ---------- Partien
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
  $('#phead').innerHTML = `<h2>Partien · ${app.rep() === 'white' ? 'Weiß' : 'Schwarz'}</h2>`;
  $('#pcfg').innerHTML = (gapCfg ? tokenHtml(gapCfg) : '') +
    `<div class="fld"><span class="lb">Accounts</span>${accBox.html()}</div>` +
    `<div class="sec">Letzte Partien</div><div class="seg" id="pmax">${MAXES.map(n => `<button data-max="${n}"${n === gmMax ? ' class="on"' : ''}>${n}</button>`).join('')}</div>`;
  accBox.render();
}
const accBox = pinBox(pdlg, {
  id: 'pac', ph: 'Account suchen', pinned: () => gapCfg?.accounts ?? [],
  pin: n => saveAccounts([...(gapCfg?.accounts ?? []), n]), unpin: n => saveAccounts((gapCfg?.accounts ?? []).filter(a => a !== n)),
});
async function saveAccounts(accounts: string[]) {
  try { gapCfg = await api('/api/gaps-config', { accounts }, 'PUT'); } finally { renderGmRes(); }
}
// Stellungen, die nicht (mehr) im Repertoire sind, werden ausgelassen
function renderGmRes() {
  const r = checks[app.rep()], b = $<HTMLButtonElement>('#pchk');
  b.disabled = !(gapCfg?.tokenSet || gapCfg?.accounts?.length) || gmBusy; b.classList.toggle('busy', gmBusy);
  b.innerHTML = gmBusy ? '<span class="spin s"></span>Abgleich läuft …' : checks.white || checks.black ? 'Erneut abgleichen' : 'Abgleichen';
  let h = gmErr ? `<div class="sec"></div><div class="note err">${esc(gmErr)}</div>` : '';
  if (r) {
    const sum = (k: Deviation['kind']) => r.deviations.reduce((a, d) => a + (d.kind === k ? d.count : 0), 0);
    h += `<div class="sec"></div><div class="kpis k4">${kpi(r.games, 'Partien')}${kpi(r.clean, 'ohne Abweichung')}${kpi(sum('own'), 'du weichst ab')}${kpi(sum('opp'), 'Gegner weicht ab')}</div>`;
    for (const [kind, title] of [['own', 'Deine Abweichungen'], ['opp', 'Gegnerzüge']] as const) {
      const ds = r.deviations.filter(d => d.kind === kind && app.S().positions[d.key]);
      if (!ds.length) continue;
      h += `<div class="sec">${title}${ds.length > 100 ? ' <span>Top 100</span>' : ''}</div><div class="list">`;
      for (const d of ds.slice(0, 100)) {
        const ply = app.pathTo(d.key).length + 1, side = ply % 2 ? 'w' : 'b', g = d.games[0];
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
    else if (act === 'go' && k) { pdlg.close(); app.go(k); }
    else if (act === 'add' && k && b?.dataset.san) {
      const san = b.dataset.san;
      await api('/api/move-san', { rep: app.rep(), from: k, san });
      const r = checks[app.rep()]; if (r) r.deviations = r.deviations.filter(d => !(d.kind === 'opp' && d.key === k && d.san === san));
      await app.load(); renderGmRes(); app.refresh();
    }
  } catch (err) { toast((err as Error).message); }
});
