# Änderungsprotokoll

Alle nennenswerten Änderungen am Projekt, die neuesten oben.

## 2026-10-24

### Neu
- Abgleich mit eigenen Partien: Der Button „Partien“ lädt deine letzten 50, 100 oder 300 Lichess-Partien und zeigt pro Repertoire, wo du selbst vom Repertoire abgewichen bist und welche Gegnerzüge fehlen, mit Häufigkeit, Datum und Link zur Partie. Zugumstellungen zurück ins Repertoire zählen nicht als Abweichung. Fehlende Gegnerzüge lassen sich direkt eintragen. Nutzt den Lichess-Token aus dem Lücken-Dialog.
- Schwachstellen im Training: Pro eigener Stellung wird gespeichert, ob der erste Versuch richtig oder falsch war. Stellungen mit Fehlern gelten als schwach, bis sie zweimal hintereinander richtig gespielt wurden. Sie tragen im Graphen einen roten Punkt, die Vorschau zeigt richtige und falsche Versuche. Der neue Button mit der Anzahl (Taste W) trainiert nur ab den Schwachstellen, mit Markierung nur ab denen darin und danach. Rechtsklick → „Statistik zurücksetzen“.
- Notizen pro Stellung: Textfeld unter dem Zugpfad, gespeichert beim Tippen. Im Graphen markiert ein gelber Punkt Stellungen mit Notiz, die Vorschau zeigt den Anfang. Im Training erscheint die Notiz erst nach einem Fehler. PGN-Kommentare werden beim Import zu Notizen und beim Export wieder zu Kommentaren, der JSON-Export enthält sie ebenfalls. Bestehende Datenbanken bekommen die neue Spalte beim ersten Start automatisch.
- Zugreihenfolge ändern: Rechtsklick auf einen Knoten bietet „Nach links“ und „Nach rechts“, ganz links steht die Hauptvariante. Die Reihenfolge bestimmt den Graphen, die Navigation mit ↓/Ende und den PGN-Export.
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
