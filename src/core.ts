import { Chess, normalizeMove } from 'chessops/chess';
import { parseFen, makeFen, INITIAL_FEN } from 'chessops/fen';
import { parseSan, makeSan } from 'chessops/san';
import { makeUci, parseUci, squareRank, squareFromCoords } from 'chessops/util';
import { isNormal, type NormalMove } from 'chessops/types';

export const START_FEN = INITIAL_FEN;

export function fromFen(fen: string): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
}
export const startPos = () => Chess.default();

/** Stellungsschlüssel: Figuren, Zugrecht, Rochaderechte und En passant nur bei echter Schlagmöglichkeit, ohne Zugzähler. */
export const keyOf = (pos: Chess): string => makeFen(pos.toSetup(), { epd: true });
export const START_KEY = keyOf(startPos());

export interface Played { uci: string; san: string; pos: Chess; key: string; fen: string }

/** Rochade intern als "König schlägt Turm", gespeichert wird die gewohnte Schreibweise (e1g1). */
function stdMove(pos: Chess, m: NormalMove): NormalMove {
  const k = pos.board.get(m.from), t = pos.board.get(m.to);
  if (k?.role === 'king' && t?.role === 'rook' && t.color === k.color)
    return { from: m.from, to: squareFromCoords(m.to > m.from ? 6 : 2, squareRank(m.from))! };
  return m;
}

export function playUci(pos: Chess, uci: string): Played | null {
  const raw = parseUci(uci);
  if (!raw || !isNormal(raw)) return null;
  const m = normalizeMove(pos, raw) as NormalMove;
  if (!pos.isLegal(m)) return null;
  const san = makeSan(pos, m);
  const next = pos.clone();
  next.play(m);
  return { uci: makeUci(stdMove(pos, m)), san, pos: next, key: keyOf(next), fen: makeFen(next.toSetup()) };
}

export function playSan(pos: Chess, san: string): Played | null {
  const m = parseSan(pos, san);
  return m ? playUci(pos, makeUci(m)) : null;
}
