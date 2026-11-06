import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from './db';
import { START_KEY } from './core';

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
  assert.deepEqual(s.deleteNodes('white', [x], true), { removed: 1 });
  assert.equal(s.deleteNodes('white', [x]).removed, 1);
  assert.ok(Object.keys(s.state('white').positions).length === 7); // Ziel bleibt über anderen Weg erhalten
  const first = play(s, 'Nf3');
  assert.equal(s.deleteNodes('white', [first]).removed, 4);
  assert.equal(count(s), 3);
});

test('Mehrere Stellungen gemeinsam löschen', () => {
  const s = fresh();
  play(s, 'e4', 'e5', 'Nf3');
  play(s, 'e4', 'c5', 'Nf3');
  const keep = play(s, 'd4', 'd5', 'c4'); // über d4 erreichbar ...
  play(s, 'c4', 'd5', 'd4'); // ... und über c4
  const st = s.state('white');
  const e4 = st.moves[START_KEY][0].to;
  const [e5, c5] = st.moves[e4].map(m => m.to);
  const c4 = st.moves[START_KEY][2].to;
  assert.equal(count(s), 11);
  assert.deepEqual(s.deleteNodes('white', [e5, c5, e5], true), { removed: 4 });
  assert.equal(count(s), 11);
  assert.equal(s.deleteNodes('white', [e5, c5]).removed, 4);
  const pos = s.state('white').positions;
  assert.ok(pos[e4] && !pos[e5] && !pos[c5]);
  assert.equal(s.deleteNodes('white', [c4]).removed, 2); // c4 und c4-d5, die Zielstellung bleibt über d4
  assert.ok(s.state('white').positions[keep]);
  assert.throws(() => s.deleteNodes('white', []));
  assert.throws(() => s.deleteNodes('white', [e4, START_KEY]));
});

test('Startstellung lässt sich nicht löschen, illegale Züge werden abgelehnt', () => {
  const s = fresh();
  assert.throws(() => s.deleteNodes('white', [START_KEY]));
  assert.throws(() => s.addMove('white', START_KEY, 'e2e5'));
});

test('Repertoires sind getrennt', () => {
  const s = fresh();
  play(s, 'e4');
  assert.equal(Object.keys(s.state('black').positions).length, 1);
});

test('Ungültige Importdaten werden abgelehnt, ohne eine Sicherung anzulegen', () => {
  const s = fresh();
  assert.throws(() => s.importJson({ foo: 1 }));
  assert.ok(!fs.existsSync(s.backupDir) || !fs.readdirSync(s.backupDir).some(n => n.includes('vor-import')));
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

test('JSON-Import nur für Schwarz lässt Weiß unverändert', () => {
  const a = fresh();
  play(a, 'e4', 'c5');
  a.addSan('black', START_KEY, 'd4');
  const b = fresh();
  play(b, 'd4');
  const vorher = b.state('white');
  const r = b.importJson(a.exportAll(), ['black']);
  assert.equal(r.moves, 1);
  assert.deepEqual(b.state('white'), vorher);
  assert.deepEqual(Object.keys(b.state('black').positions).sort(), Object.keys(a.state('black').positions).sort());
});

test('Ungültiges Format im nicht gewählten Repertoire stört nicht', () => {
  const a = fresh();
  a.addSan('black', START_KEY, 'e4');
  const data = { version: 1, white: { foo: 1 }, black: a.state('black') };
  assert.throws(() => fresh().importJson(data));
  const b = fresh();
  assert.equal(b.importJson(data, ['black']).moves, 1);
  assert.throws(() => b.importJson(data, ['white']), /white/);
  assert.throws(() => b.importJson(data, []));
});

test('Zugreihenfolge: vor und zurück, wirkt auf State und PGN-Export', () => {
  const s = fresh();
  play(s, 'e4'); play(s, 'd4'); play(s, 'c4');
  const sans = () => s.state('white').moves[START_KEY].map(m => m.san);
  const to = (san: string) => s.state('white').moves[START_KEY].find(m => m.san === san)!.to;
  s.reorderMove('white', START_KEY, to('c4'), 'up');
  assert.deepEqual(sans(), ['e4', 'c4', 'd4']);
  s.reorderMove('white', START_KEY, to('c4'), 'up');
  s.reorderMove('white', START_KEY, to('c4'), 'up');
  assert.deepEqual(sans(), ['c4', 'e4', 'd4']);
  s.reorderMove('white', START_KEY, to('e4'), 'down');
  assert.deepEqual(sans(), ['c4', 'd4', 'e4']);
  s.reorderMove('white', START_KEY, to('e4'), 'down');
  assert.deepEqual(sans(), ['c4', 'd4', 'e4']);
  s.reorderMove('white', START_KEY, to('d4'), 'up');
  assert.deepEqual(sans(), ['d4', 'c4', 'e4']);
  assert.match(s.exportPgn('white'), /^1\. d4 \( 1\. c4 \) \( 1\. e4 \)/m);
  play(s, 'b3');
  assert.deepEqual(sans(), ['d4', 'c4', 'e4', 'b3']);
  assert.throws(() => s.reorderMove('white', START_KEY, 'gibt es nicht', 'up'), /unbekannt/);
});

test('Trainingsstatistik: Zählen und Serie, Fehler setzt die Serie zurück', () => {
  const s = fresh();
  const k = play(s, 'e4');
  assert.deepEqual(s.trainStats('white'), {});
  s.recordTrain('white', k, true);
  const a = s.recordTrain('white', k, true);
  assert.deepEqual({ ...a, last: 0 }, { ok: 2, bad: 0, streak: 2, last: 0 });
  assert.ok(a.last > 0);
  const b = s.recordTrain('white', k, false);
  assert.deepEqual([b.ok, b.bad, b.streak], [2, 1, 0]);
  assert.equal(s.recordTrain('white', k, true).streak, 1);
  assert.deepEqual({ ...s.trainStats('white')[k], last: 0 }, { ok: 3, bad: 1, streak: 1, last: 0 });
  assert.deepEqual(s.trainStats('black'), {});
});

test('Trainingsstatistik: unbekannte Stellung wirft, Löschen der Stellung entfernt sie', () => {
  const s = fresh();
  assert.throws(() => s.recordTrain('white', 'gibt-es-nicht', true), /Stellung unbekannt/);
  const k = play(s, 'e4');
  assert.throws(() => s.recordTrain('black', k, true), /Stellung unbekannt/);
  s.recordTrain('white', k, true);
  s.recordTrain('white', START_KEY, false);
  s.deleteNodes('white', [k]);
  assert.deepEqual(Object.keys(s.trainStats('white')), [START_KEY]);
});

test('Trainingsstatistik zurücksetzen: einzelne Stellungen oder ganzes Repertoire', () => {
  const s = fresh();
  const a = play(s, 'e4'), b = play(s, 'd4');
  for (const k of [START_KEY, a, b]) s.recordTrain('white', k, true);
  s.recordTrain('black', START_KEY, true);
  assert.deepEqual(s.resetTrain('white', [a, 'gibt-es-nicht']), { removed: 1 });
  assert.deepEqual(Object.keys(s.trainStats('white')).sort(), [START_KEY, b].sort());
  assert.deepEqual(s.resetTrain('white'), { removed: 2 });
  assert.deepEqual(s.trainStats('white'), {});
  assert.equal(Object.keys(s.trainStats('black')).length, 1);
  assert.deepEqual(Object.keys(s.exportAll()), ['version', 'white', 'black']);
});
