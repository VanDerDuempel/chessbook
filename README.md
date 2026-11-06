# Chessbook lokal

Schach-Repertoires für Weiß und Schwarz, lokal auf deinem Rechner. Die Daten liegen in `data/` und verlassen den Rechner nicht.

## Installieren und starten
Voraussetzung: [Node.js](https://nodejs.org) 18 oder neuer und Git.

```
git clone https://github.com/VanDerDuempel/chessbook.git
```
- **Starten:** Doppelklick auf `start.bat`, der Browser öffnet sich. Das Fenster offen lassen, Schließen beendet Chessbook.
- **Aktualisieren:** Chessbook schließen, Doppelklick auf `update.bat`. Deine Daten bleiben erhalten.
- **Ohne Windows:** `npm install`, dann `npm start` und http://localhost:3000 öffnen.

## Funktionen
- **Repertoire aufbauen:** Züge auf dem Brett eintragen, Zugumstellungen werden erkannt. Pfeile und Kreise per Rechtsklick.
- **Graph:** alle Stellungen als Baum. Rechtsklick auf einen Knoten zum Verschieben, Löschen oder Trainieren, Strg+Klick oder Strg+Ziehen markiert mehrere.
- **Training (T):** Der Gegner spielt Züge aus dem Repertoire, du findest deine. **Schwachstellen (W)** trainiert gezielt die Stellungen mit Fehlern.
- **Lücken:** Häufige Gegnerzüge laut Lichess-Explorer, die im Repertoire fehlen. Braucht einen kostenlosen Lichess-Token.
- **Partien:** Gleicht deine letzten Lichess-Partien mit dem Repertoire ab.
- **Daten:** Import und Export als PGN oder JSON. Importe ergänzen nur, sie ersetzen nichts.

Tasten: ← → ↑ ↓ navigieren, F Brett drehen, / suchen (Züge, PGN oder FEN), Esc abbrechen.

## Sicherungen
Automatisch in `data/backups/` (beim Start, vor Importen und vor dem Löschen, die neuesten 30). Wiederherstellen: Chessbook schließen, eine Sicherung nach `data/chessbook.db` kopieren und `chessbook.db-wal` und `chessbook.db-shm` löschen.

## Entwicklung
`npm test`, `npm run typecheck`, `npm run build`. Code in `src/`, Oberfläche in `src/client/`.

## Bausteine
[chessground](https://github.com/lichess-org/chessground) und [chessops](https://github.com/niklasf/chessops) (GPL-3.0), Figuren „cburnett“ von Colin M.L. Burnett, better-sqlite3.
