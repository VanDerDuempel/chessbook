import test from 'node:test';
import assert from 'node:assert/strict';
import { START_KEY, keyOf, startPos, playSan, playUci, fromFen } from './core';

function line(...sans: string[]) {
  let pos = startPos(), key = START_KEY;
  for (const s of sans) { const p = playSan(pos, s); assert.ok(p, s); pos = p.pos; key = p.key; }
  return key;
}

test('Transposition ergibt denselben Stellungsschlüssel', () => {
  assert.equal(line('e4', 'e5', 'Nf3', 'Nc6'), line('Nf3', 'Nc6', 'e4', 'e5'));
});
test('Verschiedene Stellungen haben verschiedene Schlüssel', () => {
  assert.notEqual(line('e4', 'e5'), line('d4', 'd5'));
});
test('En passant zählt nur bei echter Schlagmöglichkeit', () => {
  assert.equal(line('e4'), keyOf(fromFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')));
  assert.match(line('e4', 'a6', 'e5', 'd5'), / d6$/);
});
test('Umwandlung und Rochade werden erkannt', () => {
  assert.equal(playSan(fromFen('8/P7/8/8/8/8/8/k6K w - - 0 1'), 'a8=N')?.uci, 'a7a8n');
  assert.ok(playSan(fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'O-O-O'));
});
test('Illegale Züge werden abgelehnt', () => {
  assert.equal(playSan(startPos(), 'e5'), null);
});

test('Rochade wird in beiden Schreibweisen erkannt und einheitlich gespeichert', () => {
  const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  assert.equal(playUci(fromFen(fen), 'e1g1')?.uci, 'e1g1');
  assert.equal(playUci(fromFen(fen), 'e1h1')?.uci, 'e1g1');
  assert.equal(playSan(fromFen(fen), 'O-O-O')?.uci, 'e1c1');
  assert.equal(playUci(fromFen(fen), 'e1g1')?.key, playSan(fromFen(fen), 'O-O')?.key);
});
