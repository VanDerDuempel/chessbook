import fs from 'node:fs';
import type { Source } from './explorer';

export interface Threshold { minShare: number; minGames: number }
export interface Config { lichessToken: string; source: Source; player: string; playerColor: 'auto' | 'white' | 'black'; thresholds: Record<Source, Threshold>; minReach: number; accounts: string[]; players: string[] }
const SOURCES = ['masters', 'lichess', 'player'] as const;
// Ein einzelner Spieler hat viel weniger Partien als die Datenbanken, daher eigene Schwellen pro Quelle
export const DEFAULTS: Config = {
  lichessToken: '', source: 'lichess', player: '', playerColor: 'auto', minReach: 0.005, accounts: [], players: [],
  thresholds: { masters: { minShare: 0.05, minGames: 30 }, lichess: { minShare: 0.05, minGames: 30 }, player: { minShare: 0.1, minGames: 5 } },
};
const NAME = /^[A-Za-z0-9_-]{2,30}$/;   // Lichess-Benutzername
const MAX_NAMES = 10;
// Namen ohne Groß/Klein-Duplikate, höchstens MAX_NAMES
const uniq = (ns: string[]) => ns.filter((n, i) => ns.findIndex(m => m.toLowerCase() === n.toLowerCase()) === i);
const has = (ns: string[], n: string) => ns.some(m => m.toLowerCase() === n.toLowerCase());
const copyThresholds = (t: Record<Source, Threshold>) => Object.fromEntries(SOURCES.map(s => [s, { ...t[s] }])) as Record<Source, Threshold>;

export function loadConfig(file: string): Config {
  let saved: any = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* keine oder kaputte Datei: Standardwerte */ }
  // Nur bekannte Felder übernehmen, veraltete Einträge fallen beim nächsten Speichern weg
  const c: Config = { ...DEFAULTS, thresholds: copyThresholds(DEFAULTS.thresholds), accounts: [], players: [] };
  for (const k of ['lichessToken', 'source', 'player', 'playerColor', 'minReach'] as const) if (saved?.[k] !== undefined) (c as any)[k] = saved[k];
  for (const k of ['accounts', 'players'] as const) if (Array.isArray(saved?.[k])) c[k] = uniq(saved[k].filter((a: unknown) => typeof a === 'string' && NAME.test(a))).slice(0, MAX_NAMES);
  // Alte Dateien: der bisher eingetragene Spieler wird angepinnt
  if (typeof c.player === 'string' && NAME.test(c.player) && !has(c.players, c.player)) c.players = [c.player, ...c.players].slice(0, MAX_NAMES);
  if (saved?.thresholds && typeof saved.thresholds === 'object') {
    for (const s of SOURCES) Object.assign(c.thresholds[s], saved.thresholds[s] ?? {});
  } else if (saved?.minShare !== undefined || saved?.minGames !== undefined) {
    // Alte Dateien: eine Schwelle für alle Quellen, gilt jetzt für Masters und Lichess
    for (const s of ['masters', 'lichess'] as const) {
      if (saved.minShare !== undefined) c.thresholds[s].minShare = saved.minShare;
      if (saved.minGames !== undefined) c.thresholds[s].minGames = saved.minGames;
    }
  }
  return c;
}
export const saveConfig = (file: string, c: Config) => fs.writeFileSync(file, JSON.stringify(c, null, 2));

const pick = <T extends string>(v: unknown, allowed: readonly T[], what: string): T => {
  if (!allowed.includes(v as T)) throw new Error(`Ungültige Angabe: ${what}`);
  return v as T;
};
/** Liste oder Text mit Komma/Leerzeichen; Duplikate ohne Groß/Klein-Unterschied fallen weg. */
function nameList(v: unknown, what: string, one: string): string[] {
  const raw = typeof v === 'string' ? v.split(/[\s,;]+/) : Array.isArray(v) ? v.filter((x: unknown) => typeof x === 'string') : null;
  if (!raw) throw new Error(`Ungültige Angabe: ${what}`);
  const ns = uniq(raw.map((x: string) => x.trim()).filter(Boolean));
  for (const n of ns) if (!NAME.test(n)) throw new Error(`Ungültiger ${one}: ${n.slice(0, 40)}`);
  if (ns.length > MAX_NAMES) throw new Error(`Höchstens ${MAX_NAMES} ${what}.`);
  return ns;
}
const num = (v: unknown, lo: number, hi: number, what: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`Ungültiger Wert: ${what}`);
  return n;
};

/** Übernimmt geänderte Einstellungen mit Prüfung; unbekannte Felder werden ignoriert. Schwellen als Teil-Update, z. B. {thresholds: {player: {minGames: 8}}}. */
export function patchConfig(c: Config, p: any): Config {
  const r = { ...c, thresholds: copyThresholds(c.thresholds), accounts: [...(c.accounts ?? [])], players: [...(c.players ?? [])] };
  if (p?.lichessToken !== undefined) {
    const t = String(p.lichessToken).trim();
    if (t && !/^[\w-]{8,200}$/.test(t)) throw new Error('Der Zugangsschlüssel enthält ungültige Zeichen.');
    r.lichessToken = t;
  }
  if (p?.source !== undefined) r.source = pick(p.source, SOURCES, 'Quelle');
  if (p?.player !== undefined) {
    const n = String(p.player).trim();
    if (n && !NAME.test(n)) throw new Error('Ungültiger Spielername (erlaubt sind Buchstaben, Ziffern, _ und -).');
    r.player = n;
  }
  if (p?.players !== undefined) r.players = nameList(p.players, 'Spieler', 'Spieler');
  // Der aktive Spieler ist immer angepinnt
  if (r.player && !has(r.players, r.player)) r.players = nameList([...r.players, r.player], 'Spieler', 'Spieler');
  if (p?.playerColor !== undefined) r.playerColor = pick(p.playerColor, ['auto', 'white', 'black'] as const, 'Farbe');
  if (p?.thresholds !== undefined) {
    if (!p.thresholds || typeof p.thresholds !== 'object') throw new Error('Ungültige Angabe: Schwellen');
    for (const s of Object.keys(p.thresholds)) {
      const t = p.thresholds[pick(s, SOURCES, 'Quelle')];
      if (t?.minShare !== undefined) r.thresholds[s as Source].minShare = num(t.minShare, 0.01, 0.5, 'Mindestanteil');
      if (t?.minGames !== undefined) r.thresholds[s as Source].minGames = num(t.minGames, 1, 1e6, 'Mindestanzahl Partien');
    }
  }
  if (p?.accounts !== undefined) r.accounts = nameList(p.accounts, 'Accounts', 'Account');
  if (p?.minReach !== undefined) r.minReach = num(p.minReach, 0.0005, 0.5, 'Erreichbarkeit');
  return r;
}
