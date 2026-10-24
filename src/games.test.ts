import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { Store, type Rep } from './db';
import { START_KEY } from './core';
import { parseGame, checkGames, fetchGames, type LichessGame } from './games';

const fresh = () => new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cbg-')), 't.db'));
const play = (s: Store, rep: Rep, ...sans: string[]) => { let k = START_KEY; for (const x of sans) k = s.addSan(rep, k, x).toKey; return k; };
let n = 0;
const game = (white: string, black: string, moves: string, date = ++n): LichessGame => ({ id: 'g' + date, white, black, moves: moves.split(' '), date });

// Weiß-Repertoire: 1.e4 e5 2.Nf3 Nc6 3.Bb5 und 1.e4 c5 2.Nf3
const repo = () => {
  const s = fresh();
  play(s, 'white', 'e4', 'e5', 'Nf3', 'Nc6', 'Bb5');
  play(s, 'white', 'e4', 'c5', 'Nf3');
  return s.state('white');
};

test('Partien: komplett im Repertoire und über das Repertoire-Ende hinaus gelten als sauber', () => {
  const r = checkGames(repo(), 'white', 'Ich', [game('ich', 'x', 'e4 e5 Nf3'), game('ICH', 'x', 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6')]);
  assert.deepEqual(r, { games: 2, clean: 2, deviations: [] });
});

test('Partien: eigene Abweichung und Gegnerabweichung mit Buchzügen', () => {
  const st = repo();
  const r = checkGames(st, 'white', 'ich', [game('ich', 'Gegner', 'e4 e5 Bc4 Nc6'), game('ich', 'Bot', 'e4 e6 d4 d5')]);
  assert.equal(r.games, 2); assert.equal(r.clean, 0);
  const [a, b] = r.deviations;   // gleiche Anzahl: neueste Partie zuerst
  assert.deepEqual({ kind: a.kind, san: a.san, uci: a.uci, book: a.book, ply: a.games[0].ply, opp: a.games[0].opponent }, { kind: 'opp', san: 'e6', uci: 'e7e6', book: ['e5', 'c5'], ply: 2, opp: 'Bot' });
  assert.deepEqual({ kind: b.kind, san: b.san, book: b.book, ply: b.games[0].ply, color: b.games[0].color }, { kind: 'own', san: 'Bc4', book: ['Nf3'], ply: 3, color: 'white' });
  assert.ok(st.positions[a.key] && st.positions[b.key]);
});

test('Partien: Gruppierung nach Stellung und Zug, Sortierung nach Anzahl', () => {
  const r = checkGames(repo(), 'white', 'ich', [
    game('ich', 'a', 'e4 d5', 10), game('ich', 'b', 'e4 e6', 11), game('ich', 'c', 'e4 d5 exd5', 12), game('ich', 'd', 'e4 c6', 13),
  ]);
  assert.deepEqual(r.deviations.map(d => [d.san, d.count]), [['d5', 2], ['c6', 1], ['e6', 1]]);
  assert.deepEqual(r.deviations[0].games.map(g => g.id), ['g12', 'g10']);   // neueste zuerst
});

test('Partien: Zugumstellung zurück ins Repertoire ist keine Abweichung, spätere Abweichungen zählen', () => {
  const st = repo();
  const r = checkGames(st, 'white', 'ich', [game('ich', 'x', 'Nf3 Nc6 e4 e5 Bb5'), game('ich', 'y', 'Nf3 Nc6 e4 e5 Bc4')]);
  assert.equal(r.clean, 1);
  assert.equal(r.deviations.length, 1);
  assert.deepEqual([r.deviations[0].san, r.deviations[0].kind, r.deviations[0].games[0].ply, r.deviations[0].book], ['Bc4', 'own', 5, ['Bb5']]);
});

test('Partien: falsche Farbe, fremde Spieler und illegale Züge', () => {
  const s = fresh(); play(s, 'black', 'e4', 'c5');
  const st = s.state('black');
  const r = checkGames(st, 'black', 'ich', [game('ich', 'x', 'e4 e5'), game('a', 'b', 'e4 e5'), game('x', 'ich', 'e4 Ke7'), game('x', 'ich', 'e4 e5')]);
  assert.equal(r.games, 2); assert.equal(r.clean, 0);
  assert.deepEqual(r.deviations.map(d => [d.san, d.kind]), [['e5', 'own']]);
  assert.deepEqual(checkGames(s.state('white'), 'white', 'ich', [game('ich', 'x', 'e4 e5')]), { games: 1, clean: 1, deviations: [] });   // leeres Repertoire
});

test('Partien: parseGame liest Namen, KI und Anonym, ignoriert Varianten', () => {
  assert.deepEqual(parseGame({ id: 'a', createdAt: 5, moves: 'e4 e5', players: { white: { user: { name: 'Ich' } }, black: { aiLevel: 3 } } }),
    { id: 'a', white: 'Ich', black: 'Stockfish 3', moves: ['e4', 'e5'], date: 5 });
  assert.equal(parseGame({ id: 'b', variant: 'standard', moves: '', players: { white: {}, black: {} } })?.white, 'Anonym');
  assert.equal(parseGame({ id: 'c', variant: 'chess960', moves: 'e4' }), null);
  assert.equal(parseGame({ id: 'd', variant: 'fromPosition', initialFen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: 'e4' }), null);
});

test('Partien: fetchGames holt Konto und NDJSON, meldet abgelehnten Token', async () => {
  const urls: string[] = [];
  const fetchFn = (async (url: string, init: any) => {
    urls.push(url);
    assert.equal(init.headers.authorization, 'Bearer tok');
    if (url.endsWith('/api/account')) return new Response(JSON.stringify({ username: 'Ich' }));
    return new Response([
      JSON.stringify({ id: 'a', createdAt: 1, moves: 'e4 e5', players: { white: { user: { name: 'Ich' } }, black: { user: { name: 'Du' } } } }),
      '', 'kaputt', JSON.stringify({ id: 'b', variant: 'atomic', moves: 'e4' }), '',
    ].join('\n'));
  }) as typeof fetch;
  const r = await fetchGames({ token: 'tok', max: 50, baseUrl: 'http://x', fetchFn });
  assert.equal(r.user, 'Ich');
  assert.deepEqual(r.games.map(g => g.id), ['a']);
  assert.ok(urls[1].startsWith('http://x/api/games/user/Ich?max=50&moves=true'));
  const denied = (async () => new Response('', { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(fetchGames({ token: 'tok', max: 50, fetchFn: denied }), /Token abgelehnt/);
  await assert.rejects(fetchGames({ token: '', max: 50, fetchFn: denied }), /Token/);
});
