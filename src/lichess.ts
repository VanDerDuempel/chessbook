// Gemeinsames für Anfragen an Lichess (Partien, Namenssuche, Explorer)
export const LICHESS_URL = 'https://lichess.org';
/** Lichess-Benutzername */
export const NAME = /^[A-Za-z0-9_-]{2,30}$/;

/** Header für Lichess; den Token nur mitschicken, wenn es einen gibt (öffentliche Daten brauchen keinen). */
export const lichessHeaders = (accept: string, token?: string): Record<string, string> =>
  ({ accept, 'user-agent': 'chessbook-lokal', ...(token ? { authorization: `Bearer ${token}` } : {}) });

/** Einfache GET-Anfrage ohne Wiederholung, liefert den Text. `who`: Account, für den 404 „unbekannt“ heißt. */
export async function lichessGet(url: string, o: { accept: string; token?: string; fetchFn?: typeof fetch; who?: string }): Promise<string> {
  let res: Response;
  try { res = await (o.fetchFn ?? fetch)(url, { headers: lichessHeaders(o.accept, o.token) }); }
  catch { throw new Error('Lichess ist nicht erreichbar. Bitte die Internetverbindung prüfen.'); }
  if (res.status === 401 || res.status === 403) throw new Error('Lichess hat den Token abgelehnt.');
  if (res.status === 404 && o.who) throw new Error(`Lichess kennt den Account ${o.who} nicht.`);
  if (res.status === 429) throw new Error('Lichess bremst gerade die Anfragen. Bitte später erneut versuchen.');
  if (!res.ok) throw new Error(`Lichess antwortet mit Status ${res.status}.`);
  try { return await res.text(); } catch { throw new Error('Verbindung zu Lichess abgebrochen.'); }
}
