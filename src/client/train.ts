import type { State, Rep, MoveRow, TrainStat } from '../db';
export type { TrainStat };

// Training: welche Varianten in der laufenden Runde noch offen sind

const ownTurn = (S: State, rep: Rep, k: string) => S.positions[k].fen.split(' ')[1] === rep[0];

/** Gegnerzüge zur Auswahl: nur offene Fortsetzungen, sind alle erledigt, dann alle (Stellungen der Variante ausgenommen). */
export function openMoves(S: State, k: string, seen: Set<string>, done: Set<string>): MoveRow[] {
  const ms = (S.moves[k] ?? []).filter(m => !seen.has(m.to)), open = ms.filter(m => !done.has(m.to));
  return open.length ? open : ms;
}

/**
 * Variante fehlerfrei bis zum Ende gespielt (`keys` = Stellungen in Zugreihenfolge): Endstellung erledigt,
 * dann rückwärts weiter, solange es passt. Gegnerstellung: alle Fortsetzungen erledigt.
 * Eigene Stellung: eine reicht, der eigene Zug ist frei wählbar. Rückwege in die Variante zählen als erledigt.
 */
export function markDone(S: State, rep: Rep, keys: string[], done: Set<string>) {
  done.add(keys[keys.length - 1]);
  for (let i = keys.length - 2; i >= 0; i--) {
    const k = keys[i], before = new Set(keys.slice(0, i + 1));
    const fin = (c: string) => done.has(c) || before.has(c);
    const kids = (S.moves[k] ?? []).map(m => m.to);
    if (!(ownTurn(S, rep, k) ? kids.some(fin) : kids.every(fin))) break;
    done.add(k);
  }
}

// Schwachstellen: eigene Stellungen, in denen beim ersten Versuch falsch gezogen wurde

/** So oft muss eine Stellung nach einem Fehler in Folge richtig gespielt werden, bis sie nicht mehr als schwach gilt. */
export const WEAK_STREAK = 2;

export function isWeak(s: TrainStat | undefined): boolean {
  return !!s && s.bad > 0 && s.streak < WEAK_STREAK;
}

/**
 * Schwache Stellungen, die es noch gibt und die Züge haben; mit `from` nur die von dort erreichbaren (inkl. `from`).
 * Sortiert: kleinere Serie, dann mehr Fehler, dann höherer Fehleranteil.
 */
export function weakKeys(S: State, stats: Record<string, TrainStat>, from?: string[]): string[] {
  let reach: Set<string> | undefined;
  if (from) {
    reach = new Set(from.filter(k => S.positions[k]));
    for (const k of reach) for (const m of S.moves[k] ?? []) reach.add(m.to);
  }
  const rate = (s: TrainStat) => s.bad / (s.ok + s.bad);
  return Object.keys(stats)
    .filter(k => isWeak(stats[k]) && S.positions[k] && S.moves[k]?.length && (!reach || reach.has(k)))
    .sort((a, b) => { const x = stats[a], y = stats[b]; return x.streak - y.streak || y.bad - x.bad || rate(y) - rate(x); });
}
