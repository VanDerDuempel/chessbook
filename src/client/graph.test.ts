import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../db';
import { START_KEY } from '../core';
import { layout, NODE_W } from './graph';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const fresh = () => new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cbg-')), 't.db'));
function play(s: Store, ...sans: string[]) { let k = START_KEY; for (const x of sans) k = s.addSan('white', k, x).toKey; return k; }

test('Layout: Eltern mittig über den Kindern, keine Überlappung, Startstellung nicht gezeichnet', () => {
  const s = fresh();
  play(s, 'e4', 'e5', 'Nf3'); play(s, 'e4', 'c5'); play(s, 'd4', 'd5');
  const st = s.state('white'), L = layout(st);
  assert.equal(L.pos[START_KEY], undefined);
  const byRow: Record<number, number[]> = {};
  for (const p of Object.values(L.pos)) (byRow[p.y] ??= []).push(p.x);
  for (const xs of Object.values(byRow)) { xs.sort((a, b) => a - b); for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= NODE_W); }
  const e4 = st.moves[START_KEY][0].to, kids = st.moves[e4].map(m => L.pos[m.to].x);
  assert.equal(L.pos[e4].x, (Math.min(...kids) + Math.max(...kids)) / 2);
  assert.equal(L.label[e4], '1.e4'); assert.equal(L.side[st.moves[e4][0].to], 'b');
});

test('Layout: Transposition zählt Vorgänger und bleibt ein Knoten', () => {
  const s = fresh();
  const a = play(s, 'e4', 'e5', 'Nf3', 'Nc6'); play(s, 'Nf3', 'Nc6', 'e4', 'e5');
  const L = layout(s.state('white'));
  assert.equal(L.incoming[a], 2);
  assert.equal(Object.keys(L.pos).length, 7);
});

test('Layout: doppelte Kanten zwischen denselben Stellungen erzeugen kein Transpositions-Abzeichen', () => {
  const s = fresh();
  const a = play(s, 'e4', 'e5');
  const st = s.state('white');
  const from = Object.keys(st.moves).find(k => st.moves[k].some(m => m.to === a))!;
  st.moves[from].push({ ...st.moves[from].find(m => m.to === a)!, uci: 'x' });
  assert.equal(layout(st).incoming[a], 1);
});
