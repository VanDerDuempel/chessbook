# Änderungsprotokoll

Alle nennenswerten Änderungen am Projekt, die neuesten oben.

## 2026-10-24

### Neu
- Zugreihenfolge ändern: Rechtsklick auf einen Knoten bietet „Hauptvariante“, „Nach links“ und „Nach rechts“. Die Reihenfolge bestimmt den Graphen, die Navigation mit ↓/Ende und den PGN-Export.
- Training: Das Repertoire wird ab der aktuellen Stellung abgefragt. Der Gegner zieht zufällig aus dem Repertoire, falsche eigene Züge zählen als Fehler und zeigen die Lösung als Pfeil. Zähler für richtige und falsche Züge, Neustart am Ende jeder Variante. Taste T, Escape beendet.

- Training ab markierten Stellungen: Rechtsklick auf einen Knoten bietet „Training ab hier“, bei mehreren markierten Knoten werden alle Varianten ab diesen Stellungen abgefragt. Button und Taste T nehmen ebenfalls die Markierung.

### Geändert
- Training: Fehlerfrei gespielte Varianten kommen in derselben Runde nicht wieder, Varianten mit Fehler schon. Sind alle geschafft, beginnt eine neue Runde. Vorher wählte der Gegner rein zufällig, sodass manche Varianten mehrfach und andere kaum drankamen.
- Training: Der Graph ist nicht mehr verschwommen, sondern deckt sich beim Spielen auf. Fehlerfrei geschaffte Stellungen werden grün. Nach einem Fehler wird die Variante nur bis zur Fehlerstelle aufgedeckt, die rot bleibt, bis die Variante fehlerfrei nachgespielt ist. Jede neue Runde beginnt verdeckt.

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
