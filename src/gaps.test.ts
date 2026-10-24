import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { Store } from './db';
import { START_KEY } from './core';
import { scanGaps } from './gaps';
import { ExplorerClient, ExplorerError, type ExplorerData } from './explorer';
import { patchConfig, loadConfig, saveConfig, DEFAULTS } from './config';

const fresh = () => new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cbx-')), 't.db'));
const play = (s: Store, rep: 'white' | 'black', ...sans: string[]) => { let k = START_KEY; for (const x of sans) k = s.addSan(rep, k, x).toKey; return k; };
const mk = (...m: [string, number][]): ExplorerData => ({ games: m.reduce((a, b) => a + b[1], 0), moves: m.map(([san, games]) => ({ san, uci: san, games })) });
const opt = { minShare: 0.05, minGames: 30, minReach: 0.005 };

test('Lücken: häufige Gegnerzüge ohne Antwort werden gefunden und nach Wahrscheinlichkeit sortiert', async () => {
  const s = fresh();
  const k1 = play(s, 'white', 'e4'), k3 = (play(s, 'white', 'e4', 'e5'), play(s, 'white', 'e4', 'e5', 'Nf3'));
  play(s, 'white', 'e4', 'e5', 'Nf3', 'Nc6');
  const data: Record<string, ExplorerData> = {
    [k1]: mk(['e5', 500], ['c5', 300], ['e6', 120], ['a6', 20], ['h6', 60]),
    [k3]: mk(['Nc6', 700], ['Nf6', 200], ['d6', 100]),
  };
  const r = await scanGaps(s.state('white'), 'white', async k => data[k] ?? null, opt);
  assert.deepEqual(r.gaps.map(g => g.san), ['c5', 'e6', 'Nf6', 'h6', 'd6']);   // nach Wahrscheinlichkeit sortiert
  const bySan = Object.fromEntries(r.gaps.map(g => [g.san, g]));
  assert.equal(bySan.a6, undefined);                       // 2 % liegen unter dem Mindestanteil
  assert.equal(bySan.e5, undefined);                       // schon abgedeckt
  assert.equal(bySan.Nf6.reach, 0.5);                      // e4 e5 wird mit 500 von 1000 Partien erreicht
  assert.ok(Math.abs(bySan.Nf6.score - 0.1) < 1e-9);
});

test('Lücken: eigene Enden (du bist am Zug, kein Zug hinterlegt) werden gemeldet', async () => {
  const s = fresh();
  const k = play(s, 'white', 'e4', 'e5');
  const r = await scanGaps(s.state('white'), 'white', async key => (key === s.state('white').moves[START_KEY][0].to ? mk(['e5', 100]) : null), opt);
  assert.deepEqual(r.own.map(o => o.key), [k]);
});

test('Lücken: Schwarz-Repertoire fragt schon die Startstellung ab, seltene Stellungen werden übersprungen', async () => {
  const s = fresh();
  play(s, 'black', 'e4', 'c5', 'Nf3', 'd6');
  const st = s.state('black');
  const afterE4 = st.moves[START_KEY][0].to, afterC5 = st.moves[afterE4][0].to, afterNf3 = st.moves[afterC5][0].to, afterD6 = st.moves[afterNf3][0].to;
  const data: Record<string, ExplorerData> = {
    [START_KEY]: mk(['e4', 600], ['d4', 350], ['Nf3', 40], ['c4', 10]),
    [afterC5]: mk(['Nf3', 5], ['Nc3', 995]),
  };
  const asked: string[] = [];
  const r = await scanGaps(st, 'black', async k => { asked.push(k); return data[k] ?? null; }, opt);
  assert.deepEqual(r.gaps.map(g => g.san), ['Nc3', 'd4']);   // Nf3 (4 %) und c4 (1 %) liegen unter 5 %
  assert.ok(asked.includes(START_KEY) && asked.includes(afterC5));
  assert.ok(!asked.includes(afterD6));                        // nur 0,3 % Erreichbarkeit: wird nicht abgefragt
});

const ok = (j: unknown, status = 200, raw?: string) => ({ ok: status < 300, status, text: async () => raw ?? JSON.stringify(j) }) as Response;
const mkClient = (fetchFn: typeof fetch, settings: any = { source: 'lichess' }, token = 'tok_12345678') =>
  new ExplorerClient({ token, settings, fetchFn, delayMs: 0, retryWaitMs: 0, netRetryMs: 0, sleep: async () => {} });
const body = { white: 5, draws: 3, black: 2, moves: [{ san: 'e5', uci: 'e7e5', white: 3, draws: 2, black: 1 }] };

test('Explorer-Client: Lichess-Datenbank, Summen und Token', async () => {
  let seen = { url: '', auth: '' };
  const c = mkClient((async (u: string, o: any) => { seen = { url: u, auth: o.headers.authorization }; return ok(body); }) as any);
  assert.deepEqual(await c.query('fen x'), { games: 10, moves: [{ san: 'e5', uci: 'e7e5', games: 6 }] });
  assert.match(seen.url, /explorer\.lichess\.ovh\/lichess\?/); assert.match(seen.url, /variant=standard/); assert.doesNotMatch(seen.url, /ratings=/);
  assert.equal(seen.auth, 'Bearer tok_12345678');
});

test('Explorer-Client: Masters und Spieler fragen die richtigen Adressen ab', async () => {
  let url = '';
  const f = (async (u: string) => { url = u; return ok(body); }) as any;
  await mkClient(f, { source: 'masters' }).query('f');
  assert.match(url, /explorer\.lichess\.ovh\/masters\?/); assert.doesNotMatch(url, /variant=/);
  await mkClient(f, { source: 'player', player: 'beispiel', color: 'black' }).query('f');
  assert.match(url, /explorer\.lichess\.ovh\/player\?/); assert.match(url, /player=beispiel/); assert.match(url, /color=black/);
});

test('Explorer-Client: Spieler-Antwort als NDJSON (mehrere Zeilen, die letzte zählt)', async () => {
  const nd = [JSON.stringify({ white: 1, draws: 0, black: 0, moves: [] }), '', JSON.stringify(body)].join('\n');
  const d = await mkClient((async () => ok(null, 200, nd)) as any, { source: 'player', player: 'beispiel', color: 'white' }).query('f');
  assert.equal(d.games, 10);
  assert.equal(d.moves[0].san, 'e5');
});

// Antwort als Strom aus Teilstücken; mit fail bricht der Strom danach mit Fehler ab (wie ECONNRESET beim Lesen)
const streamed = (parts: string[], fail = false) => {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({ start(c) {
    for (const p of parts) c.enqueue(enc.encode(p));
    if (fail) c.error(Object.assign(new TypeError('terminated'), { cause: { code: 'ECONNRESET' } })); else c.close();
  } });
  return { ok: true, status: 200, body } as unknown as Response;
};
const playerSettings = { source: 'player', player: 'beispiel', color: 'white' };

test('Explorer-Client: Spieler wird eingelesen, Fortschritt pro Zeile, Ergebnis ist die letzte Zeile', async () => {
  const l1 = JSON.stringify({ white: 1, draws: 0, black: 1, moves: [], queuePosition: 33 });
  const l2 = JSON.stringify({ white: 3, draws: 1, black: 2, moves: [], queuePosition: 0 });
  const nd = `${l1}\n${l2}\n${JSON.stringify(body)}\n`;
  const seen: unknown[] = [];
  // Zeilen über Teilstücke verteilt, damit das Zusammensetzen geprüft wird
  const d = await mkClient((async () => streamed([nd.slice(0, 10), nd.slice(10, 60), nd.slice(60)])) as any, playerSettings).query('f', p => seen.push(p));
  assert.deepEqual(seen, [{ queue: 33, games: 2 }, { queue: 0, games: 6 }, { queue: null, games: 10 }]);
  assert.deepEqual(d, { games: 10, moves: [{ san: 'e5', uci: 'e7e5', games: 6 }] });
  // Normales (auch mehrzeiliges) JSON als Strom funktioniert weiter
  assert.equal((await mkClient((async () => streamed([JSON.stringify(body, null, 2)])) as any).query('f')).games, 10);
});

test('Explorer-Client: Abbruch beim Lesen wird wiederholt, nach 4 Versuchen verständlicher Fehler', async () => {
  let calls = 0;
  const partial = JSON.stringify({ white: 1, draws: 0, black: 0, moves: [], queuePosition: 5 }) + '\n{"whi';
  const c = mkClient((async () => (++calls < 3 ? streamed([partial], true) : streamed([JSON.stringify(body)]))) as any, playerSettings);
  assert.equal((await c.query('f')).games, 10);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(mkClient((async () => { calls++; return streamed([partial], true); }) as any, playerSettings).query('f'),
    (e: ExplorerError) => e.code === 'NETWORK' && /abgebrochen/.test(e.message) && /ECONNRESET/.test(e.message));
  assert.equal(calls, 4);
  calls = 0;
  const flaky = mkClient((async () => { if (++calls < 4) throw new TypeError('fetch failed'); return ok(body); }) as any);
  assert.equal((await flaky.query('f')).games, 10);
});

test('Explorer-Client: Fehler werden verständlich gemeldet', async () => {
  let calls = 0;
  await assert.rejects(mkClient((async () => ok({}, 401)) as any).query('f'), (e: ExplorerError) => e.code === 'UNAUTHORIZED');
  await assert.rejects(mkClient((async () => ok({}, 401)) as any, { source: 'lichess' }, '').query('f'), (e: ExplorerError) => e.code === 'NO_TOKEN');
  await assert.rejects(mkClient((async () => ok({}, 404)) as any, { source: 'player', player: 'nobodyx', color: 'white' }).query('f'), (e: ExplorerError) => e.code === 'NOT_FOUND');
  const retry = mkClient((async () => (++calls < 2 ? ok({}, 429) : ok({ white: 1, draws: 0, black: 0, moves: [] }))) as any);
  assert.equal((await retry.query('f')).games, 1);
  await assert.rejects(mkClient((async () => { throw new Error('offline'); }) as any).query('f'), (e: ExplorerError) => e.code === 'NETWORK');
});

test('Einstellungen werden geprüft', () => {
  assert.equal(patchConfig(DEFAULTS, { lichessToken: ' lip_abcdefgh12 ' }).lichessToken, 'lip_abcdefgh12');
  assert.throws(() => patchConfig(DEFAULTS, { lichessToken: 'x y;z' }));
  assert.equal(patchConfig(DEFAULTS, { source: 'masters' }).source, 'masters');
  assert.throws(() => patchConfig(DEFAULTS, { source: 'chesscom' }));
  assert.equal(patchConfig(DEFAULTS, { player: ' Beispiel_1 ' }).player, 'Beispiel_1');
  assert.throws(() => patchConfig(DEFAULTS, { player: 'a b' }));
  assert.throws(() => patchConfig(DEFAULTS, { playerColor: 'rot' }));
  assert.equal(patchConfig(DEFAULTS, { playerColor: 'black' }).playerColor, 'black');
});

test('Einstellungen: Schwellen pro Quelle als Teil-Update mit Prüfung', () => {
  const c = patchConfig(DEFAULTS, { thresholds: { player: { minGames: 8 } } });
  assert.deepEqual(c.thresholds.player, { minShare: 0.1, minGames: 8 });
  assert.deepEqual(c.thresholds.masters, { minShare: 0.05, minGames: 30 });
  assert.equal(DEFAULTS.thresholds.player.minGames, 5);                // Standardwerte bleiben unverändert
  assert.equal(patchConfig(c, { thresholds: { lichess: { minShare: 0.2 } } }).thresholds.lichess.minShare, 0.2);
  assert.throws(() => patchConfig(DEFAULTS, { thresholds: { player: { minShare: 0.9 } } }));
  assert.throws(() => patchConfig(DEFAULTS, { thresholds: { player: { minGames: 0 } } }));
  assert.throws(() => patchConfig(DEFAULTS, { thresholds: { chesscom: { minGames: 5 } } }));
  assert.throws(() => patchConfig(DEFAULTS, { thresholds: 'x' }));
});

test('Einstellungen: Lichess-Accounts als Liste oder Text, ohne Duplikate', () => {
  assert.deepEqual(DEFAULTS.accounts, []);
  assert.deepEqual(patchConfig(DEFAULTS, { accounts: ['Ich', ' zwei_2 ', '', 'ICH'] }).accounts, ['Ich', 'zwei_2']);
  assert.deepEqual(patchConfig(DEFAULTS, { accounts: 'a-b, CdE  cde,,x_y' }).accounts, ['a-b', 'CdE', 'x_y']);
  assert.deepEqual(patchConfig(patchConfig(DEFAULTS, { accounts: 'ab' }), { accounts: '' }).accounts, []);
  assert.throws(() => patchConfig(DEFAULTS, { accounts: ['a'] }), /Account/);
  assert.throws(() => patchConfig(DEFAULTS, { accounts: 'gut, bö$e' }), /Account/);
  assert.throws(() => patchConfig(DEFAULTS, { accounts: 5 }), /Accounts/);
  assert.throws(() => patchConfig(DEFAULTS, { accounts: Array.from({ length: 11 }, (_, i) => 'acc' + i) }), /10/);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cbc-')), 'config.json');
  fs.writeFileSync(file, JSON.stringify({ accounts: ['Ich', 7, 'x y', 'Du'] }));
  assert.deepEqual(loadConfig(file).accounts, ['Ich', 'Du']);
  assert.deepEqual(loadConfig(file + '.fehlt').accounts, []);
});

test('Einstellungen: alte Datei mit minShare/minGames wird auf Schwellen pro Quelle umgestellt', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cbc-')), 'config.json');
  fs.writeFileSync(file, JSON.stringify({ source: 'masters', minShare: 0.5, minGames: 300, minReach: 0.01 }));
  const c = loadConfig(file);
  assert.deepEqual(c.thresholds, { masters: { minShare: 0.5, minGames: 300 }, lichess: { minShare: 0.5, minGames: 300 }, player: { minShare: 0.1, minGames: 5 } });
  assert.equal(c.minReach, 0.01);
  saveConfig(file, c);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.minShare, undefined); assert.equal(saved.minGames, undefined);
  assert.deepEqual(loadConfig(file), c);
});

test('Lücken: Abfragen werden auch ohne Fortschrittsmeldung gezählt', async () => {
  const s = fresh();
  play(s, 'white', 'e4');
  const r = await scanGaps(s.state('white'), 'white', async () => mk(['e5', 100]), opt);
  assert.equal(r.queried, 1);
});
