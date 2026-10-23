export type Source = 'masters' | 'lichess' | 'player';
export interface ExplorerSettings { source: Source; player?: string; color?: 'white' | 'black' }
export interface ExplorerMove { san: string; uci: string; games: number }
export interface ExplorerData { games: number; moves: ExplorerMove[] }
/** Zwischenstand, solange Lichess einen Spieler einliest: Platz in der Warteschlange (null = nicht angegeben) und bisher gezählte Partien. */
export interface ExplorerProgress { queue: number | null; games: number }
export type ExplorerErrorCode = 'NO_TOKEN' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'RATE_LIMIT' | 'NETWORK' | 'HTTP' | 'FORMAT';
export class ExplorerError extends Error {
  constructor(readonly code: ExplorerErrorCode, message: string) { super(message); }
}

interface Options {
  token: string; settings: ExplorerSettings; baseUrl?: string; fetchFn?: typeof fetch;
  delayMs?: number; retryWaitMs?: number; netRetryMs?: number; sleep?: (ms: number) => Promise<void>;
}

const ATTEMPTS = 4;   // Versuche bei Verbindungsfehlern
const count = (x: any) => (Number(x?.white) || 0) + (Number(x?.draws) || 0) + (Number(x?.black) || 0);

/**
 * Liest die Antwort als Strom: ein JSON oder beim Spieler-Explorer eine Folge von JSON-Zeilen (NDJSON), die über Minuten
 * eintreffen kann, solange Lichess die Partien einliest. Die letzte Zeile mit Zügen ist das Ergebnis.
 */
async function readBody(res: Response, onLine: (j: any) => void): Promise<any> {
  let all = '', buf = '', last: any = null;
  const line = (s: string) => {
    if (!s.trim()) return;
    try { const j = JSON.parse(s); if (Array.isArray(j?.moves)) { last = j; onLine(j); } } catch { /* unvollständig oder mehrzeiliges JSON */ }
  };
  const feed = (s: string) => {
    all += s; buf += s;
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) line(buf.slice(0, i));
  };
  if (res.body) {
    const reader = res.body.getReader(), dec = new TextDecoder();
    for (;;) { const { done, value } = await reader.read(); if (done) break; feed(dec.decode(value, { stream: true })); }
    feed(dec.decode());
  } else feed(await res.text());
  line(buf);
  if (last) return last;
  try { return JSON.parse(all); } catch { return null; }
}

/** Fragt die Eröffnungsdaten von Lichess ab (Masters, alle Lichess-Spieler oder ein einzelner Spieler): eine Anfrage nach der anderen, mit Pause dazwischen; bei "zu viele Anfragen" wird gewartet, abgebrochene Verbindungen werden wiederholt. */
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

  async query(fen: string, onProgress?: (p: ExplorerProgress) => void): Promise<ExplorerData> {
    const o = this.o, sleep = o.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
    const url = this.url(fen);
    let limited = 0, failed = 0;
    // Verbindungsfehler beim Verbinden oder Lesen: warten und neu versuchen, nach dem letzten Versuch verständlich melden
    const netFail = async (e: unknown) => {
      if (++failed < ATTEMPTS) return sleep(o.netRetryMs ?? 5000);
      const err = e as Error & { cause?: { code?: string } };
      throw new ExplorerError('NETWORK', `Verbindung zu Lichess abgebrochen (${ATTEMPTS} Versuche, zuletzt: ${err?.cause?.code ?? err?.message ?? 'unbekannt'}). Bitte später erneut versuchen.`);
    };
    for (;;) {
      const wait = this.last + (o.delayMs ?? 1100) - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      let res: Response;
      try {
        res = await (o.fetchFn ?? fetch)(url, { headers: { accept: 'application/json', 'user-agent': 'chessbook-lokal', ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) } });
      } catch (e) { await netFail(e); continue; }
      if (res.status === 401 || res.status === 403)
        throw new ExplorerError(o.token ? 'UNAUTHORIZED' : 'NO_TOKEN', o.token ? 'Lichess hat den Zugangsschlüssel abgelehnt. Bitte einen neuen eintragen.' : 'Lichess verlangt einen Zugangsschlüssel (Token) für die Eröffnungsdaten.');
      if (res.status === 404 && o.settings.source === 'player') throw new ExplorerError('NOT_FOUND', 'Lichess kennt diesen Spieler nicht. Bitte den Namen prüfen.');
      if (res.status === 429) {
        if (++limited >= 3) throw new ExplorerError('RATE_LIMIT', 'Lichess bremst die Anfragen. Bitte später erneut versuchen.');
        await sleep(o.retryWaitMs ?? 60_000); continue;
      }
      if (!res.ok) throw new ExplorerError('HTTP', `Lichess antwortete mit Status ${res.status}.`);
      let j: any;
      try {
        j = await readBody(res, l => onProgress?.({ queue: typeof l.queuePosition === 'number' ? l.queuePosition : null, games: count(l) }));
      } catch (e) { await netFail(e); continue; }
      if (!j || !Array.isArray(j.moves)) throw new ExplorerError('FORMAT', 'Unerwartete Antwort von Lichess.');
      return { games: count(j), moves: j.moves.map((m: any) => ({ san: String(m.san), uci: String(m.uci), games: count(m) })) };
    }
  }
}
