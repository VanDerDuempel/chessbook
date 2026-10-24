import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, type State, type Rep } from '../db';
import { START_KEY } from '../core';
import { openMoves, markDone, isWeak, weakKeys, WEAK_STREAK, type TrainStat } from './train';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const fresh = () => new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cbt-')), 't.db'));
function play(s: Store, rep: Rep, ...sans: string[]) { let k = START_KEY; for (const x of sans) k = s.addSan(rep, k, x).toKey; return k; }

// Eine Variante wie im Training: eigener Zug = erster Repertoirezug, Gegner zufällig aus den offenen
function line(S: State, rep: Rep, done: Set<string>, rnd: () => number) {
  const seen = new Set([S.root]); let k = S.root; const sans: string[] = [];
  for (;;) {
    const own = S.positions[k].fen.split(' ')[1] === rep[0];
    const ms = own ? (S.moves[k] ?? []).filter(m => !seen.has(m.to)) : openMoves(S, k, seen, done);
    if (!ms.length) return { keys: [...seen], sans };
    const m = own ? ms[0] : ms[Math.floor(rnd() * ms.length)];
    seen.add(m.to); sans.push(m.san); k = m.to;
  }
}

test('Training: jede Variante genau einmal pro Runde, dann neue Runde', () => {
  const s = fresh();
  play(s, 'white', 'e4', 'e5', 'Nf3', 'Nc6', 'Bb5'); play(s, 'white', 'e4', 'e5', 'Nf3', 'd6', 'd4');
  play(s, 'white', 'e4', 'c5', 'Nf3'); play(s, 'white', 'e4', 'e6', 'd4');
  const S = s.state('white'), done = new Set<string>();
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const got: string[] = [];
  while (!done.has(S.root)) { const l = line(S, 'white', done, rnd); got.push(l.sans.join(' ')); markDone(S, 'white', l.keys, done); assert.ok(got.length <= 4); }
  assert.deepEqual([...got].sort(), ['e4 c5 Nf3', 'e4 e5 Nf3 Nc6 Bb5', 'e4 e5 Nf3 d6 d4', 'e4 e6 d4']);
});

test('Training: fehlerhafte Variante bleibt offen', () => {
  const s = fresh();
  play(s, 'white', 'e4', 'e5', 'Nf3'); play(s, 'white', 'e4', 'c5', 'Nf3');
  const S = s.state('white'), done = new Set<string>(), e4 = S.moves[S.root][0].to;
  const e5 = S.moves[e4].find(m => m.san === 'e5')!, c5 = S.moves[e4].find(m => m.san === 'c5')!;
  markDone(S, 'white', [S.root, e4, e5.to, S.moves[e5.to][0].to], done);
  assert.deepEqual(openMoves(S, e4, new Set([S.root, e4]), done).map(m => m.san), ['c5']);
  assert.ok(!done.has(S.root));
  // c5 mit Fehler gespielt: nichts markiert, c5 bleibt die einzige offene Fortsetzung
  assert.deepEqual(openMoves(S, e4, new Set([S.root, e4]), done).map(m => m.san), ['c5']);
  markDone(S, 'white', [S.root, e4, c5.to, S.moves[c5.to][0].to], done);
  assert.ok(done.has(S.root));
});

test('Training: Schwarz, eigene Stellung mit zwei Zügen reicht ein erledigter', () => {
  const s = fresh();
  play(s, 'black', 'e4', 'c5'); play(s, 'black', 'e4', 'e5'); play(s, 'black', 'd4', 'd5');
  const S = s.state('black'), done = new Set<string>();
  const e4 = S.moves[S.root].find(m => m.san === 'e4')!.to, c5 = S.moves[e4].find(m => m.san === 'c5')!.to;
  markDone(S, 'black', [S.root, e4, c5], done);
  assert.ok(done.has(e4) && !done.has(S.root));
  assert.deepEqual(openMoves(S, S.root, new Set([S.root]), done).map(m => m.san), ['d4']);
});

const st = (ok: number, bad: number, streak: number): TrainStat => ({ ok, bad, streak, last: 0 });

test('isWeak: nur mit Fehlern und kurzer Serie', () => {
  assert.equal(isWeak(undefined), false);
  assert.equal(isWeak(st(5, 0, 0)), false);
  assert.equal(isWeak(st(0, 1, 0)), true);
  assert.equal(isWeak(st(3, 1, WEAK_STREAK - 1)), true);
  assert.equal(isWeak(st(3, 1, WEAK_STREAK)), false);
});

test('weakKeys: nur vorhandene Stellungen mit Zügen, sortiert nach Serie, Fehlern, Fehleranteil', () => {
  const s = fresh();
  const e5 = play(s, 'white', 'e4', 'e5'), c5 = play(s, 'white', 'e4', 'c5'), d5 = play(s, 'white', 'd4', 'd5'), e6 = play(s, 'white', 'e4', 'e6');
  play(s, 'white', 'e4', 'e5', 'Nf3'); play(s, 'white', 'e4', 'c5', 'Nf3'); play(s, 'white', 'd4', 'd5', 'c4'); play(s, 'white', 'e4', 'e6', 'd4');
  const leaf = play(s, 'white', 'e4', 'e5', 'Nf3', 'Nc6'), S = s.state('white');
  const stats: Record<string, TrainStat> = {
    [e5]: st(9, 1, 0), [c5]: st(0, 3, 1), [d5]: st(1, 1, 0), [e6]: st(0, 1, 0),
    [leaf]: st(0, 5, 0), fehlt: st(0, 5, 0), [S.root]: st(4, 0, 0),
  };
  assert.deepEqual(weakKeys(S, stats), [e6, d5, e5, c5]);
  stats[e5] = st(9, 4, 0);
  assert.deepEqual(weakKeys(S, stats), [e5, e6, d5, c5]);
});

test('weakKeys: mit from nur von dort erreichbare Stellungen, inklusive from selbst', () => {
  const s = fresh();
  const e4 = play(s, 'white', 'e4'), e5 = play(s, 'white', 'e4', 'e5'), d5 = play(s, 'white', 'd4', 'd5');
  play(s, 'white', 'e4', 'e5', 'Nf3'); play(s, 'white', 'd4', 'd5', 'c4');
  const S = s.state('white'), stats = { [e5]: st(0, 1, 0), [d5]: st(0, 2, 0) };
  assert.deepEqual(weakKeys(S, stats, [e4]), [e5]);
  assert.deepEqual(weakKeys(S, stats, [d5]), [d5]);
  assert.deepEqual(weakKeys(S, stats, [e5, d5]), [d5, e5]);
  assert.deepEqual(weakKeys(S, stats, ['fehlt']), []);
  assert.deepEqual(weakKeys(S, stats, [S.root]), [d5, e5]);
});
