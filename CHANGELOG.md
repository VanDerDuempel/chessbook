# Änderungsprotokoll

Alle nennenswerten Änderungen am Projekt, die neuesten oben.

## 2026-11-06

### Neu
- `start.bat`: Doppelklick startet Chessbook und öffnet den Browser. Läuft der Server schon, wird nur der Browser geöffnet.

## 2026-10-24

### Neu
- Abgleich mit eigenen Partien: Der Button „Partien“ lädt deine letzten 50, 100 oder 300 Lichess-Partien und zeigt pro Repertoire, wo du selbst vom Repertoire abgewichen bist und welche Gegnerzüge fehlen, mit Häufigkeit, Datum und Link zur Partie. Zugumstellungen zurück ins Repertoire zählen nicht als Abweichung. Fehlende Gegnerzüge lassen sich direkt eintragen. Eigene Lichess-Accounts lassen sich wie auf Lichess suchen und anpinnen (bis zu 10, ohne Token); ohne angepinnten Account zählt der Account hinter dem Lichess-Token aus dem Lücken-Dialog.
- Schwachstellen im Training: Pro eigener Stellung wird gespeichert, ob der erste Versuch richtig oder falsch war. Stellungen mit Fehlern gelten als schwach, bis sie zweimal hintereinander richtig gespielt wurden. Sie tragen im Graphen einen roten Punkt, die Vorschau zeigt richtige und falsche Versuche. Der neue Button mit der Anzahl (Taste W) trainiert nur ab den Schwachstellen, mit Markierung nur ab denen darin und danach. Rechtsklick → „Statistik zurücksetzen“.
- Zugreihenfolge ändern: Rechtsklick auf einen Knoten bietet „Nach links“ und „Nach rechts“, ganz links steht die Hauptvariante. Die Reihenfolge bestimmt den Graphen, die Navigation mit ↓/Ende und den PGN-Export.
- Training: Das Repertoire wird ab der aktuellen Stellung abgefragt. Der Gegner zieht zufällig aus dem Repertoire, falsche eigene Züge zählen als Fehler und zeigen die Lösung als Pfeil. Zähler für richtige und falsche Züge, Neustart am Ende jeder Variante. Taste T, Escape beendet.

- Training ab markierten Stellungen: Rechtsklick auf einen Knoten bietet „Training ab hier“, bei mehreren markierten Knoten werden alle Varianten ab diesen Stellungen abgefragt. Button und Taste T nehmen ebenfalls die Markierung.

### Geändert
- Lücken mit Quelle „Spieler“: Statt eines Textfelds gibt es wie im Spieler-Explorer auf Lichess eine Suche mit Vorschlägen. Gefundene Spieler werden angepinnt (bis zu 10), ein Klick auf einen Chip macht ihn zum aktiven Spieler (grün), × entpinnt. Der bisher eingetragene Spieler wird automatisch angepinnt.
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
