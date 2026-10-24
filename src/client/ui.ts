// Gemeinsame Helfer der Oberfläche (ohne Zustand)
export const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
export const attr = (el: Element | null, name: string) => el?.closest(`[${name}]`)?.getAttribute(name) ?? null;

export async function api(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? 'Fehler');
  return j;
}
export function toast(msg: string) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  setTimeout(() => { t.hidden = true; }, 3500);
}
export const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export const de = (x: number) => x.toLocaleString('de-DE');
export const kpi = (v: string | number, l: string) => `<div><b>${typeof v === 'number' ? de(v) : v}</b><span>${l}</span></div>`;
