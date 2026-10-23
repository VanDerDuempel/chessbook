# Chessbook lokal

Lokales Schach-Repertoire-Tool mit einem Weiß- und einem Schwarz-Repertoire. Die Daten liegen in einer SQLite-Datei auf deinem Rechner, begrenzt nur durch die Festplatte.

## Starten
Voraussetzung: Node.js 18 oder neuer (`node -v`).

```
npm install
npm start
```
Dann http://localhost:3000 öffnen. Der Server hört nur auf diesem Rechner (127.0.0.1). Das Terminal muss offen bleiben, solange du arbeitest (beenden mit Strg+C).

Anderer Port: `set PORT=3001 && npm start` (Windows) bzw. `PORT=3001 npm start` (Linux/Mac).

## Bedienung
- **Zug eintragen:** Figur ziehen oder anklicken. Mehrere Antworten pro Stellung sind möglich. Landet eine Zugfolge in einer bekannten Stellung, werden die Wege automatisch zusammengelegt (Transposition). Bei Umwandlungen erscheint eine Figurenauswahl.
- **Pfeile und Kreise:** Rechtsklick (ziehen für Pfeile, einfach klicken für Kreise), mit Umschalt/Strg rot, mit Alt blau, beides gelb. Sie hängen an der Stellung.
- **Navigation:** Buttons unter dem Brett oder Tasten: ← → eine Stellung, ↑ / Pos1 zum Start, ↓ / Ende ans Ende der Variante, F Brett umdrehen. Der Zugpfad darunter ist anklickbar.
- **Graph:** Baum aller Stellungen. Mausrad zoomt, Ziehen verschiebt, Klick springt zur Stellung, Fahren über einen Knoten zeigt eine Vorschau. Orange Linien führen zur aktuellen Stellung, grüne weg davon, die aktuelle Zugfolge ist blau. Ein Abzeichen zeigt Stellungen, die über mehrere Zugfolgen erreichbar sind.
- **Löschen:** Rechtsklick auf einen Knoten. Gelöscht wird die Stellung und alles, was danach nicht mehr erreichbar ist. Stellungen, die über einen anderen Weg erreichbar bleiben, bleiben erhalten. Bei mehr als einer betroffenen Stellung fragt das Programm nach.
- **Analysieren:** Öffnet Lichess mit der Zugfolge, Brett immer aus Sicht des Repertoires.

## Daten
Im Dialog **Daten**: Export als JSON (beide Repertoires samt Pfeilen und Kreisen) oder als PGN (für Lichess-Studien, Pfeile und Kreise als `[%cal]`/`[%csl]`). Import von JSON (auch aus dem Prototyp) oder PGN mit Varianten; es wird nur hinzugefügt. Ein erneuter Import ändert nichts.

## Sicherungen
- Datenbank: `data/chessbook.db`
- Sicherungen: `data/backups/` (beim Start höchstens alle 12 Stunden, vor jedem Import, vor dem Löschen höchstens alle 10 Minuten; die neuesten 30 bleiben erhalten)
- Wiederherstellen: Server beenden, eine Datei aus `data/backups/` nach `data/chessbook.db` kopieren und die Dateien `chessbook.db-wal` und `chessbook.db-shm` daneben löschen.
- Zusätzlich empfohlen: ab und zu den Ordner `data` an einen anderen Ort kopieren.

## Entwicklung
- `npm test` Tests, `npm run typecheck` Typprüfung, `npm run build` baut `public/app.js` neu (nach Änderungen unter `src/client`).
- `src/core.ts` Schachlogik und Stellungsschlüssel, `src/db.ts` Datenbank, Import und Export, `src/server.ts` lokale Schnittstelle, `src/client/` Oberfläche.

## Bausteine
Brett: [chessground](https://github.com/lichess-org/chessground), Regeln und PGN: [chessops](https://github.com/niklasf/chessops) (beide GPL-3.0), Figuren "cburnett" von Colin M.L. Burnett (Lichess-Standardsatz), Datenbank: better-sqlite3.
