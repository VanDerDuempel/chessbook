# Änderungsprotokoll

Alle nennenswerten Änderungen am Projekt, die neuesten oben.

## 2026-10-24

### Neu
- Training: Das Repertoire wird ab der aktuellen Stellung abgefragt. Der Gegner zieht zufällig aus dem Repertoire, falsche eigene Züge zählen als Fehler und zeigen die Lösung als Pfeil. Zähler für richtige und falsche Züge, Neustart am Ende jeder Variante. Taste T, Escape beendet.

## 2026-10-23

### Neu
- Mehrere Züge im Graphen markieren (Strg+Klick, am Mac Cmd+Klick) und per Rechtsklick gemeinsam löschen. Escape oder ein normaler Klick hebt die Markierung auf.
- Rechteck-Auswahl im Graphen: Strg+Ziehen (am Mac Cmd+Ziehen) fügt alle Knoten, die das Rechteck berühren, zur Markierung hinzu. Escape bricht ab, am Rand scrollt die Ansicht mit.
- Import im Dialog „Daten“: Ziel wählbar. Ein PGN geht wahlweise nach Weiß oder Schwarz, aus einem JSON-Export lassen sich beide oder nur ein Repertoire übernehmen.

### Geändert
- Lücken-Erkennung: Mindestanteil und Mindestanzahl Partien gelten jetzt pro Quelle (Standard für Spieler 10 % und 5 Partien). Bisherige Werte gelten weiter für Masters und Lichess.
- Lücken-Erkennung mit Quelle „Spieler“: Während Lichess die Partien eines Spielers einliest, zeigt der Dialog Warteschlangenplatz und bisher eingelesene Partien, statt scheinbar stillzustehen.
- Nach dem Löschen eines Zugs springt die Ansicht zur Stellung vor dem gelöschten Zug statt zur Startstellung. Gibt es diese nicht mehr, geht es zur nächsten erhaltenen Stellung davor auf dem Zugpfad.

### Behoben
- Lücken-Erkennung: Abgebrochene Verbindungen zu Lichess werden bis zu viermal wiederholt, statt die Suche mit der Meldung „terminated“ zu beenden.
