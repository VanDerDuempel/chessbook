export type Source = 'masters' | 'lichess' | 'player';
export interface ExplorerSettings { source: Source; player?: string; color?: 'white' | 'black' }
export interface ExplorerMove { san: string; uci: string; games: number }
export interface ExplorerData { games: number; moves: ExplorerMove[] }
export type ExplorerErrorCode = 'NO_TOKEN' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'RATE_LIMIT' | 'NETWORK' | 'HTTP' | 'FORMAT';
export class ExplorerError extends Error {
  constructor(readonly code: ExplorerErrorCode, message: string) { super(message); }
}

interface Options {
  token: string; settings: ExplorerSettings; baseUrl?: string; fetchFn?: typeof fetch;
  delayMs?: number; retryWaitMs?: number; sleep?: (ms: number) => Promise<void>;
}

/** Die Antwort ist ein JSON; beim Spieler-Explorer eine Folge von JSON-Zeilen (NDJSON), von der die letzte mit Zügen das Ergebnis ist. */
function parseBody(text: string): any {
  try { return JSON.parse(text); } catch { /* wahrscheinlich NDJSON */ }
  for (const line of text.split('\n').reverse()) {
    if (!line.trim()) continue;
    try { const j = JSON.parse(line); if (Array.isArray(j?.moves)) return j; } catch { /* nächste Zeile */ }
  }
  return null;
}

/** Fragt die Eröffnungsdaten von Lichess ab (Masters, alle Lichess-Spieler oder ein einzelner Spieler): eine Anfrage nach der anderen, mit Pause dazwischen; bei "zu viele Anfragen" wird gewartet. */
export class ExplorerClient {
  private last = 0;
  constructor(private o: Options) {}

  private url(fen: string): string {
    const s = this.o.settings, p: Record<string, string> = { fen, moves: '20', topGames: '0', recentGames: '0' };
    let endpoint = 'masters';
    if (s.source !== 'masters') p.variant = 'standard';
    if (s.source === 'lichess') endpoint = 'lichess';
    if (s.source === 'player') { endpoint = 'player'; p.player = s.player ?? ''; p.color = s.color ?? 'white'; }
    return `${this.o.baseUrl ?? 'https://explorer.lichess.ovh'}/${endpoint}?` + new URLSearchParams(p);
  }

  async query(fen: string): Promise<ExplorerData> {
    const o = this.o, sleep = o.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
    const url = this.url(fen);
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = this.last + (o.delayMs ?? 1100) - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      let res: Response;
      try {
        res = await (o.fetchFn ?? fetch)(url, { headers: { accept: 'application/json', 'user-agent': 'chessbook-lokal', ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) } });
      } catch (e) { throw new ExplorerError('NETWORK', 'Keine Verbindung zu Lichess: ' + (e as Error).message); }
      if (res.status === 401 || res.status === 403)
        throw new ExplorerError(o.token ? 'UNAUTHORIZED' : 'NO_TOKEN', o.token ? 'Lichess hat den Zugangsschlüssel abgelehnt. Bitte einen neuen eintragen.' : 'Lichess verlangt einen Zugangsschlüssel (Token) für die Eröffnungsdaten.');
      if (res.status === 404 && o.settings.source === 'player') throw new ExplorerError('NOT_FOUND', 'Lichess kennt diesen Spieler nicht. Bitte den Namen prüfen.');
      if (res.status === 429) { await sleep(o.retryWaitMs ?? 60_000); continue; }
      if (!res.ok) throw new ExplorerError('HTTP', `Lichess antwortete mit Status ${res.status}.`);
      const j = parseBody(await res.text());
      if (!j || !Array.isArray(j.moves)) throw new ExplorerError('FORMAT', 'Unerwartete Antwort von Lichess.');
      const count = (x: any) => (Number(x?.white) || 0) + (Number(x?.draws) || 0) + (Number(x?.black) || 0);
      return { games: count(j), moves: j.moves.map((m: any) => ({ san: String(m.san), uci: String(m.uci), games: count(m) })) };
    }
    throw new ExplorerError('RATE_LIMIT', 'Lichess bremst die Anfragen. Bitte später erneut versuchen.');
  }
}
