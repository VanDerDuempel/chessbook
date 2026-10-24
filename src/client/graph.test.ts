import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../db';
import { START_KEY } from '../core';
import { layout, renderGraph, keysInRect, NODE_W, NODE_H } from './graph';
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
  assert.equal(L.num[e4] + L.san[e4], '1.e4'); assert.equal(L.side[st.moves[e4][0].to], 'b');
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

test('renderGraph: markierte Knoten bekommen die Klasse sel, andere nicht', () => {
  const s = fresh();
  const a = play(s, 'e4', 'e5'), b = play(s, 'd4');
  const st = s.state('white'), L = layout(st);
  const svg = renderGraph(L, st, b, 1, undefined, new Set([a, b]));
  const cls = (k: string) => { const i = svg.indexOf(`data-k="${k}"`); return svg.slice(svg.lastIndexOf('<g class="', i) + 10, i - 2).split(' '); };
  assert.ok(cls(a).includes('sel')); assert.deepEqual(cls(b).filter(c => c === 'cur' || c === 'sel'), ['cur', 'sel']);
  assert.ok(!cls(st.moves[START_KEY][0].to).includes('sel'));
});

test('keysInRect: berührte Knoten zählen, Ecken in beliebiger Reihenfolge', () => {
  const s = fresh();
  play(s, 'e4', 'e5', 'Nf3'); play(s, 'e4', 'c5'); play(s, 'd4', 'd5');
  const L = layout(s.state('white')), all = Object.keys(L.pos).sort();
  const [a, b] = Object.keys(L.pos).sort((x, y) => L.pos[x].x - L.pos[y].x || L.pos[x].y - L.pos[y].y);
  const p = L.pos[a];
  assert.deepEqual(keysInRect(L, -1e4, -1e4, 1e4, 1e4).sort(), all);
  assert.deepEqual(keysInRect(L, 1e4, 1e4, -1e4, -1e4).sort(), all);
  assert.deepEqual(keysInRect(L, p.x + 5, p.y + 5, p.x + 6, p.y + 6), [a]);
  assert.deepEqual(keysInRect(L, p.x + NODE_W + 2, p.y + NODE_H + 2, p.x + NODE_W - 2, p.y + NODE_H - 2), [a]);
  assert.ok(!keysInRect(L, p.x, p.y, p.x + 1, p.y + 1).includes(b));
  assert.deepEqual(keysInRect(L, -50, -50, -10, -10), []);
});

test('Training: nur aufgedeckte Knoten und Kanten, rot vor grün', () => {
  const s = fresh();
  const nf3 = play(s, 'e4', 'e5', 'Nf3'); play(s, 'e4', 'c5'); play(s, 'd4', 'd5');
  const st = s.state('white'), L = layout(st), e4 = st.moves[START_KEY][0].to, e5 = st.moves[e4][0].to;
  const svg = renderGraph(L, st, e5, 1, undefined, undefined, { shown: new Set([e4, e5]), ok: new Set([e4, e5]), bad: new Set([e5]) });
  const cls = (k: string) => { const i = svg.indexOf(`data-k="${k}"`); return svg.slice(svg.lastIndexOf('<g class="', i) + 10, i - 2).split(' '); };
  assert.equal((svg.match(/<g class="n /g) ?? []).length, 2);
  assert.equal((svg.match(/<path class="e/g) ?? []).length, 1);
  assert.ok(!svg.includes(`data-k="${nf3}"`));
  assert.ok(cls(e4).includes('tok') && !cls(e4).includes('tbad'));
  assert.ok(cls(e5).includes('tbad') && !cls(e5).includes('tok'));
});
