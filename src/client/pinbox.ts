// Lichess-Namen suchen (wie auf Lichess) und anpinnen, geteilt von Lücken und Partien
import { api, toast, esc } from './ui';
import type { LichessUser } from '../games';

export interface PinOpts { id: string; ph: string; pinned(): string[]; active?(): string; pin(n: string): Promise<void>; unpin(n: string): Promise<void>; select?(n: string): Promise<void> }
const xIcon = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>';
export const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** Suchfeld mit Vorschlagsliste und Chips im Dialog `dlg`. Die Handler hängen einmal am Dialog, html() liefert das Markup bei jedem Neuzeichnen. */
export function pinBox(dlg: HTMLDialogElement, o: PinOpts) {
  let list: LichessUser[] = [], idx = -1, seq = 0, timer = 0, escNow = false;
  const q = () => dlg.querySelector<HTMLInputElement>(`#${o.id}q`), l = () => dlg.querySelector<HTMLElement>(`#${o.id}l`);
  const isPinned = (n: string) => o.pinned().some(a => sameName(a, n));
  function renderList() {
    const el = l(), inp = q(); if (!el || !inp) return;
    const open = list.length > 0;
    el.hidden = !open; inp.setAttribute('aria-expanded', String(open));
    // Fest am Suchfeld ausrichten, damit die Liste über den Dialogrand hinausragen darf statt abgeschnitten zu werden
    if (open) { const r = inp.closest('.acq')!.getBoundingClientRect(); Object.assign(el.style, { left: r.left + 'px', top: r.bottom + 4 + 'px', width: r.width + 'px' }); }
    el.innerHTML = list.map((u, i) => `<button type="button" role="option" data-pin="${esc(u.name)}"${i === idx ? ' class="on" aria-selected="true"' : ''}>${u.title ? `<span class="ttl">${esc(u.title)}</span>` : ''}${esc(u.name)}</button>`).join('');
    el.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
  function render() {
    const inp = q(), box = dlg.querySelector(`#${o.id}p`); if (!inp || !box) return;
    const ns = o.pinned(), act = o.active?.() ?? '';
    inp.disabled = ns.length >= 10;
    box.innerHTML = ns.map(n => {
      const on = !!act && sameName(n, act);
      const name = o.select ? `<button type="button" class="nm" data-sel="${esc(n)}"${on ? ' aria-pressed="true"' : ' title="Auswählen"'}>${esc(n)}</button>` : esc(n);
      return `<span class="pin${on ? ' on' : ''}">${name}<button type="button" data-unpin="${esc(n)}" title="Entpinnen" aria-label="Entpinnen">${xIcon}</button></span>`;
    }).join('');
  }
  const close = () => { clearTimeout(timer); seq++; list = []; idx = -1; renderList(); };
  async function search(term: string) {
    const n = ++seq;
    try {
      const r = await api('/api/lichess/users?term=' + encodeURIComponent(term));
      if (n !== seq) return;   // veraltete Antwort
      list = (r.users as LichessUser[]).filter(u => !isPinned(u.name)); idx = -1; renderList();
    } catch (e) { if (n === seq) toast((e as Error).message); }
  }
  async function run(f: () => Promise<void>) { try { await f(); } catch (e) { toast((e as Error).message); } render(); }
  async function pin(name: string) {
    close(); const inp = q(); if (inp) inp.value = '';
    if (!isPinned(name)) await run(() => o.pin(name));
    q()?.focus();
  }
  const mine = (e: Event) => (e.target as HTMLElement).id === o.id + 'q';
  dlg.addEventListener('input', e => {
    if (!mine(e)) return;
    const v = (e.target as HTMLInputElement).value.trim();
    close();
    if (v.length >= 3) timer = window.setTimeout(() => search(v), 250);
  });
  dlg.addEventListener('keydown', e => {
    if (!mine(e)) return;
    const n = list.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!n) return;
      e.preventDefault(); idx = e.key === 'ArrowDown' ? (idx + 1) % n : (idx <= 0 ? n : idx) - 1; renderList();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const v = (e.target as HTMLInputElement).value.trim(), u = list[idx] ?? list.find(x => sameName(x.name, v)) ?? list[0];
      if (u) pin(u.name);
    } else if (e.key === 'Escape' && n) {
      // nur die Liste schließen, nicht den Dialog
      e.preventDefault(); e.stopPropagation(); escNow = true; setTimeout(() => { escNow = false; }); close();
    }
  });
  dlg.addEventListener('cancel', e => { if (escNow) e.preventDefault(); });
  dlg.addEventListener('focusout', e => { if (mine(e)) close(); });
  dlg.addEventListener('scroll', e => { if (list.length && e.target !== l()) close(); }, true);   // fest positionierte Liste würde sonst verrutschen
  dlg.addEventListener('mousedown', e => { if ((e.target as HTMLElement).closest(`#${o.id}l`)) e.preventDefault(); });   // Fokus im Suchfeld lassen
  dlg.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b?.closest(`#${o.id}l, #${o.id}p`)) return;
    if (b.dataset.pin) pin(b.dataset.pin);
    else if (b.dataset.unpin) { const n = b.dataset.unpin; run(() => o.unpin(n)); }
    else if (b.dataset.sel && o.select) { const n = b.dataset.sel; run(() => o.select!(n)); }
  });
  return {
    render,
    html: () => {
      close();
      return `<div class="acs"><label class="acq"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/></svg>` +
        `<input id="${o.id}q" type="search" placeholder="${o.ph}" maxlength="30" autocomplete="off" spellcheck="false" role="combobox" aria-controls="${o.id}l" aria-expanded="false"></label><div id="${o.id}l" class="acl" role="listbox" hidden></div></div><div id="${o.id}p" class="pins"></div>`;
    },
  };
}
