import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from './db';
import { START_KEY, START_FEN } from './core';

const fresh = () => new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-')), 't.db'));
function play(s: Store, ...sans: string[]) {
  let k = START_KEY;
  for (const x of sans) k = s.addSan('white', k, x).toKey;
  return k;
}
const count = (s: Store) => Object.keys(s.state('white').positions).length;

test('Transpositionen werden zu einer Stellung zusammengelegt', () => {
  const s = fresh();
  const a = play(s, 'e4', 'e5', 'Nf3', 'Nc6');
  const b = play(s, 'Nf3', 'Nc6', 'e4', 'e5');
  assert.equal(a, b);
  assert.equal(count(s), 8);
});

test('Wiederholtes Eintragen erzeugt keine Duplikate', () => {
  const s = fresh();
  play(s, 'e4', 'e5');
  const r = s.addSan('white', START_KEY, 'e4');
  assert.equal(r.newMove, false);
  assert.equal(count(s), 3);
});

test('Löschen entfernt nur, was unerreichbar wird (B/C/D-Beispiel)', () => {
  const s = fresh();
  play(s, 'e4', 'e5', 'Nf3', 'Nc6');
  play(s, 'Nf3', 'Nc6', 'e4', 'e5');
  const x = play(s, 'e4', 'e5', 'Nf3');
  assert.deepEqual(s.deleteNode('white', x, true), { removed: 1 });
  assert.equal(s.deleteNode('white', x).removed, 1);
  assert.ok(Object.keys(s.state('white').positions).length === 7); // Ziel bleibt über anderen Weg erhalten
  const first = play(s, 'Nf3');
  assert.equal(s.deleteNode('white', first).removed, 4);
  assert.equal(count(s), 3);
});

test('Startstellung lässt sich nicht löschen, illegale Züge werden abgelehnt', () => {
  const s = fresh();
  assert.throws(() => s.deleteNode('white', START_KEY));
  assert.throws(() => s.addMove('white', START_KEY, 'e2e5'));
});

test('Repertoires sind getrennt', () => {
  const s = fresh();
  play(s, 'e4');
  assert.equal(Object.keys(s.state('black').positions).length, 1);
});

test('Import aus dem Prototyp übernimmt Züge, Pfeile und Kreise', () => {
  const s = fresh();
  const data = {
    w: {
      root: 'r', nodes: { r: { fen: START_FEN }, a: { fen: 'x', arrows: [{ f: 'e2', t: 'e4', c: 'g' }, { f: 'e4', t: 'e4', c: 'r' }] }, b: { fen: 'y' } },
      edges: { r: [{ san: 'e4', to: 'a' }], a: [{ san: 'e5', to: 'b' }], b: [] },
    },
    b: { root: 'x', nodes: { x: { fen: START_FEN } }, edges: { x: [] } },
  };
  const stats = s.importPrototype(data);
  assert.deepEqual(stats, { positions: 2, moves: 2, skipped: 0, shapes: 2 });
  const st = s.state('white');
  const e4 = st.moves[START_KEY][0].to;
  assert.deepEqual(st.positions[e4].shapes, [{ orig: 'e2', dest: 'e4', brush: 'green' }, { orig: 'e4', brush: 'red' }]);
  assert.ok(fs.readdirSync(s.backupDir).some(n => n.includes('vor-import')));
  assert.equal(s.importPrototype(data).moves, 0); // zweiter Import ändert nichts
});

test('Ungültige Importdaten werden abgelehnt', () => {
  assert.throws(() => fresh().importPrototype({ foo: 1 }));
});

test('PGN-Import mit Varianten und Pfeilen', () => {
  const s = fresh();
  const r = s.importPgn('white', '[Event "x"]\n\n1. e4 {[%cal Ge2e4][%csl Rd4]} e5 (1... c5 2. Nf3) 2. Nf3 *');
  assert.deepEqual(r, { games: 1, positions: 5, moves: 5, skipped: 0, shapes: 2 });
  const st = s.state('white');
  const e4 = st.moves[START_KEY][0].to;
  assert.deepEqual(st.positions[e4].shapes, [{ orig: 'e2', dest: 'e4', brush: 'green' }, { orig: 'd4', brush: 'red' }]);
  assert.equal(s.importPgn('white', '1. e4 e5 *').moves, 0);
});

test('PGN-Export und erneuter Import ergeben denselben Graphen (auch mit Transpositionen)', () => {
  const a = fresh();
  play(a, 'e4', 'e5', 'Nf3', 'Nc6');
  play(a, 'Nf3', 'Nc6', 'e4', 'e5');
  play(a, 'd4', 'd5');
  const e4 = a.state('white').moves[START_KEY][0].to;
  a.setShapes('white', e4, [{ orig: 'e2', dest: 'e4', brush: 'blue' }]);
  const pgn = a.exportPgn('white');
  const b = fresh();
  b.importPgn('white', pgn);
  const sa = a.state('white'), sb = b.state('white');
  assert.deepEqual(Object.keys(sb.positions).sort(), Object.keys(sa.positions).sort());
  const edges = (st: typeof sa) => Object.entries(st.moves).flatMap(([f, ms]) => ms.map(m => `${f}>${m.uci}>${m.to}`)).sort();
  assert.deepEqual(edges(sb), edges(sa));
  assert.deepEqual(sb.positions[e4].shapes, [{ orig: 'e2', dest: 'e4', brush: 'blue' }]);
});

test('Export dieses Programms lässt sich wieder einlesen', () => {
  const a = fresh();
  play(a, 'e4', 'c5', 'Nf3');
  const b = fresh();
  const r = b.importJson(a.exportAll());
  assert.equal(r.skipped, 0);
  assert.deepEqual(Object.keys(b.state('white').positions).sort(), Object.keys(a.state('white').positions).sort());
});

test('Alte Rochade-Schreibweise (e1h1) wird beim Öffnen mit e1g1 zusammengeführt', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-')), 't.db');
  const s = new Store(file);
  play(s, 'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O');
  const before = s.state('white');
  const castle = Object.entries(before.moves).flatMap(([f, ms]) => ms.map(m => ({ f, ...m }))).find(m => m.san === 'O-O')!;
  assert.equal(castle.uci, 'e1g1');
  s.db.prepare("INSERT INTO moves(repertoire,from_key,to_key,uci,san,ord) VALUES('white',?,?,?,?,99)").run(castle.f, castle.to, 'e1h1', 'O-O');
  s.db.pragma('user_version = 1');
  s.db.close();
  const again = new Store(file);
  const after = again.state('white');
  const all = Object.values(after.moves).flat();
  assert.equal(all.filter(m => m.san === 'O-O').length, 1);
  assert.equal(all.length, Object.values(before.moves).flat().length);
  assert.ok(fs.readdirSync(again.backupDir).some(n => n.includes('vor-migration')));
});
