import type { Chess } from 'chessops/chess';
import { parsePgn } from 'chessops/pgn';
import { fromFen, keyOf, playSan, playUci } from '../core';
import type { State } from '../db';

export type Found = { key: string; played: number; total: number } | { error: string };

/** Sucht eine Stellung per FEN oder PGN/Zugfolge (SAN oder UCI). Bei PGN zählt die Hauptvariante der ersten Partie,
 *  Startstellung ist die Kopfzeile [FEN] oder die Grundstellung. Verlässt die Zugfolge das Repertoire,
 *  kommt die letzte bekannte Stellung mit `played` < `total`. */
export function findPosition(S: State, input: string): Found {
  const q = input.trim();
  if (!q) return { error: 'Leer' };
  if (q.split(/\s/)[0].split('/').length === 8) {
    let key: string;
    try { key = keyOf(fromFen(q)); } catch { return { error: 'Ungültige FEN' }; }
    return S.positions[key] ? { key, played: 0, total: 0 } : { error: 'Nicht im Repertoire' };
  }
  const game = parsePgn(q)[0];
  if (!game) return { error: 'Keine Züge' };
  const sans = [...game.moves.mainline()].map(d => d.san);
  const fen = game.headers.get('FEN');
  let pos: Chess;
  try { pos = fen ? fromFen(fen) : fromFen(S.positions[S.root].fen); } catch { return { error: 'Ungültige FEN' }; }
  let last = S.positions[keyOf(pos)] ? keyOf(pos) : null, played = 0;
  for (let i = 0; i < sans.length; i++) {
    const p = playSan(pos, sans[i]) ?? playUci(pos, sans[i].toLowerCase());
    if (!p) return { error: `Ungültiger Zug: ${sans[i]}` };
    pos = p.pos;
    if (S.positions[p.key]) { last = p.key; played = i + 1; }
  }
  return last ? { key: last, played, total: sans.length } : { error: 'Nicht im Repertoire' };
}
