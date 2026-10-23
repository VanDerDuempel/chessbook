import fs from 'node:fs';

export type Source = 'masters' | 'lichess' | 'player';
export interface Config { lichessToken: string; source: Source; player: string; playerColor: 'auto' | 'white' | 'black'; minShare: number; minGames: number; minReach: number }
export const DEFAULTS: Config = { lichessToken: '', source: 'lichess', player: '', playerColor: 'auto', minShare: 0.05, minGames: 30, minReach: 0.005 };

export function loadConfig(file: string): Config {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
export const saveConfig = (file: string, c: Config) => fs.writeFileSync(file, JSON.stringify(c, null, 2));

const pick = <T extends string>(v: unknown, allowed: readonly T[], what: string): T => {
  if (!allowed.includes(v as T)) throw new Error(`Ungültige Angabe: ${what}`);
  return v as T;
};
const num = (v: unknown, lo: number, hi: number, what: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`Ungültiger Wert: ${what}`);
  return n;
};

/** Übernimmt geänderte Einstellungen mit Prüfung; unbekannte Felder werden ignoriert. */
export function patchConfig(c: Config, p: any): Config {
  const r = { ...c };
  if (p?.lichessToken !== undefined) {
    const t = String(p.lichessToken).trim();
    if (t && !/^[\w-]{8,200}$/.test(t)) throw new Error('Der Zugangsschlüssel enthält ungültige Zeichen.');
    r.lichessToken = t;
  }
  if (p?.source !== undefined) r.source = pick(p.source, ['masters', 'lichess', 'player'] as const, 'Quelle');
  if (p?.player !== undefined) {
    const n = String(p.player).trim();
    if (n && !/^[A-Za-z0-9_-]{2,30}$/.test(n)) throw new Error('Ungültiger Spielername (erlaubt sind Buchstaben, Ziffern, _ und -).');
    r.player = n;
  }
  if (p?.playerColor !== undefined) r.playerColor = pick(p.playerColor, ['auto', 'white', 'black'] as const, 'Farbe');
  if (p?.minShare !== undefined) r.minShare = num(p.minShare, 0.01, 0.5, 'Mindestanteil');
  if (p?.minGames !== undefined) r.minGames = num(p.minGames, 1, 1e6, 'Mindestanzahl Partien');
  if (p?.minReach !== undefined) r.minReach = num(p.minReach, 0.0005, 0.5, 'Erreichbarkeit');
  return r;
}
