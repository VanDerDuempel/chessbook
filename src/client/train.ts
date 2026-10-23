import type { State, Rep, MoveRow } from '../db';

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
