import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, type Rep } from '../db';
import { START_KEY } from '../core';
import { findPosition } from './search';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const fresh = () => new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cbs-')), 't.db'));
function play(s: Store, rep: Rep, ...sans: string[]) { let k = START_KEY; for (const x of sans) k = s.addSan(rep, k, x).toKey; return k; }

test('Suche per Zugfolge mit Zugnummern, Kommentaren und Zeichen', () => {
  const s = fresh(); const k = play(s, 'white', 'e4', 'c5', 'Nf3', 'd6'); const S = s.state('white');
  assert.deepEqual(findPosition(S, '1.e4 c5 2.Nf3 d6'), { key: k, played: 4, total: 4 });
  assert.deepEqual(findPosition(S, '1. e4 {Gut} c5!? 2. Nf3 2... d6 *'), { key: k, played: 4, total: 4 });
  assert.deepEqual(findPosition(S, 'e2e4 c7c5 g1f3 d7d6'), { key: k, played: 4, total: 4 });
});

test('Suche findet Zugumstellungen und bricht an der letzten bekannten Stellung ab', () => {
  const s = fresh(); const k = play(s, 'white', 'Nf3', 'c5', 'e4'); const S = s.state('white');
  assert.deepEqual(findPosition(S, 'e4 c5 Nf3'), { key: k, played: 3, total: 3 });
  assert.deepEqual(findPosition(S, 'Nf3 c5 e4 d6 d4'), { key: k, played: 3, total: 5 });
  assert.deepEqual(findPosition(S, 'a4'), { key: START_KEY, played: 0, total: 1 });
});

test('Suche per FEN und Fehler', () => {
  const s = fresh(); const k = play(s, 'black', 'e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O'); const S = s.state('black');
  assert.deepEqual(findPosition(S, '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. 0-0'), { key: k, played: 9, total: 9 });
  const fen = S.positions[k].fen;
  assert.deepEqual(findPosition(S, fen), { key: k, played: 0, total: 0 });
  assert.deepEqual(findPosition(S, fen.split(' ').slice(0, 4).join(' ')), { key: k, played: 0, total: 0 });
  assert.deepEqual(findPosition(S, '8/8/8/8/8/8/8/8 w - -'), { error: 'Ungültige FEN' });
  assert.deepEqual(findPosition(S, 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1'), { error: 'Nicht im Repertoire' });
  assert.deepEqual(findPosition(S, 'e4 e4'), { error: 'Ungültiger Zug: e4' });
  assert.deepEqual(findPosition(S, '1. e4 e5 1/2-1/2'), { key: play(s, 'black', 'e4', 'e5'), played: 2, total: 2 });
});

test('Suche per PGN mit Kopfzeilen, Varianten, Kommentaren und mehreren Partien', () => {
  const s = fresh(); const k = play(s, 'white', 'e4', 'c5', 'Nf3', 'd6'); const S = s.state('white');
  const pgn = `[Event "Test"]
[White "A"]
[Black "B"]

1. e4 c5 ; Sizilianisch
2. Nf3 (2. Nc3 (2. c3 d5) Nc6) 2... d6 {[%cal Gd2d4]} 3. d4 $1 1-0

[Event "Zweite"]

1. d4 *`;
  assert.deepEqual(findPosition(S, pgn), { key: k, played: 4, total: 5 });
});

test('Suche per PGN mit FEN-Kopfzeile', () => {
  const s = fresh(); const k = play(s, 'white', 'e4', 'c5', 'Nf3', 'd6'); const S = s.state('white');
  const fen = S.positions[play(s, 'white', 'e4', 'c5')].fen;
  assert.deepEqual(findPosition(S, `[SetUp "1"]\n[FEN "${fen}"]\n\n2. Nf3 d6 *`), { key: k, played: 2, total: 2 });
  assert.deepEqual(findPosition(S, `[FEN "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1"]\n\n1... a6 *`), { error: 'Nicht im Repertoire' });
});
