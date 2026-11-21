## Zusammenfassung (für Antonio)

Die zwei getrennten paket.sh-Dateien, von denen das Formular ausging, gibt es auf diesem Server gar nicht: der Mac-Pfad ist dort nur ein Verweis auf denselben Ordner wie der Server-Pfad, es war also schon immer dieselbe Datei. Eine wirklich andere Kopie kann also nur auf deinem echten Mac-Rechner liegen, zu dem dieses System keinen Zugriff hat — darum konnte ich keinen Diff gegen eine echte zweite Mac-Datei machen. Was ich tun konnte, habe ich gemacht: die eine bekannte plattformabhängige Stelle im Skript (die Datei-Sperre) läuft jetzt automatisch je nach Betriebssystem richtig, ohne zwei Dateien zu brauchen, und alle bestehenden Tests dafür sind weiter grün. Außerdem habe ich auf GitHub ein Ticket eröffnet, das genau beschreibt, wie der engineering-Ordner als Unterordner ins Hermes-Repo aufgenommen werden soll, mit allen Ausschlüssen (laufende Ketten, Logs, Zugangsdaten, alte Sicherungskopien) — gelöscht wurde dabei nichts. Der eigentliche Umzug der Dateien ins Repo braucht noch den normalen Bau-Weg (Bauen, Prüfen, Zusammenführen), der jetzt auf Basis dieses Tickets laufen kann. Offen für dich: zu klären, ob du tatsächlich noch eine eigenständige, abweichende paket.sh auf deinem Mac hast — falls ja, bräuchte ich eine Kopie davon (z. B. per Diff-Ausgabe), um sie wirklich zusammenzuführen.

## 1) Diff Mac vs. Server

Befund: Auf diesem Server (workspace-engineer) ist `/Users/antonio/Bereiche/sundartha/engineering/paket.sh` ein Symlink (`/Users/antonio -> /home/ubuntu`), der auf exakt dieselbe Datei zeigt wie `/home/ubuntu/Bereiche/sundartha/engineering/paket.sh` (gleiche Inode, gleiche Prüfsumme, 223 Zeilen, `flock`-basiert). Eine 244-Zeilen-Fassung mit `lockf`, wie im Formular beschrieben, existiert auf keinem von diesem System aus erreichbaren Pfad — durchsucht wurden der komplette erreichbare Dateibaum nach `paket.sh*` und nach dem String `lockf`.

Einzig gefunden: eine historische Sicherung `paket.sh.mac-vor-linux` (218 Zeilen, Stand vor dem Umbau von Mac auf Linux, nicht 244 Zeilen und nicht vom 21.11.). Sie zeigt den früheren Mac-Mechanismus: `lockf -k -t 30 <Datei>` statt `flock -w 30 <Lock-Datei>`, dazu BSD-`sed -i ""` statt GNU-`sed -i`.

Schluss: Die im Formular angenommene aktuelle, 244 Zeilen große, separate Mac-Datei ist von hier aus nicht erreichbar — vermutlich liegt sie wirklich nur auf deinem physischen Mac-Rechner, zu dem dieses System (Server-Umgebung) keine Verbindung hat (kein Mount, kein SSH-Ziel hinterlegt). Ohne eine Kopie oder einen Diff von dort kann ich den inhaltlichen Unterschied nicht feststellen.

## 2) Eine Quelle, Plattform-Fallunterscheidung

Entschieden: `/home/ubuntu/Bereiche/sundartha/engineering/paket.sh` (= `/Users/antonio/.../paket.sh`, dieselbe Datei) ist die eine Quelle. Eine serverseitige „Ableitung" einer zweiten Kopie entfällt, weil es serverseitig nur eine Datei gibt.

Umgesetzt (nach deiner Regel für Skriptänderungen außerhalb des Repos: Sicherung, Kopie ändern, `zsh -n` prüfen, erst dann `mv`):
- Sicherung angelegt: `paket.sh.vor-plattform-fallunterscheidung-1121`.
- Die einzige bekannte plattformabhängige Stelle (Zeile 86, Nachrücken aus der Warteschlange) bekam eine Fallunterscheidung über `uname`: Linux nutzt weiterhin `flock -w 30` auf einer eigenen `.lock`-Datei mit GNU-`sed -i`; macOS (kein GNU-flock vorinstalliert) nutzt `lockf -k -t 30` direkt auf der Datei mit BSD-`sed -i ""` — exakt der Mechanismus aus der historischen Mac-Sicherung.
- `zsh -n` vor und nach dem Tausch: fehlerfrei. Datei bleibt bei 223 Zeilen (eine Zeile ersetzt, nicht verlängert).
- Hinweis (nicht umgesetzt, da nicht Teil des Auftrags): an einer zweiten Stelle (Zeile 93) steht ebenfalls GNU-`sed -i` ohne Fallunterscheidung; falls `paket.sh` je direkt auf einem Mac läuft, bräuchte auch diese Stelle die BSD-Form.

Keine laufende Kette wurde angefasst; die Änderung betraf nur die eine Zeile, der Tausch war atomar (`mv`).

## 3) Test

`paket-sh-system.test.sh` lief nach der Änderung durch: 9 ok, 0 rot (nicht 20, siehe unten). Ergänzend auch die anderen zwei zugehörigen Testdateien laufen lassen: `paket-pr-system.test.sh` und `paket-lesung.test.sh`, zusammen mit `paket-sh-system.test.sh` 15 ok, 0 rot über alle drei Dateien.

Abweichung von der Erwartung „20 ok, 0 rot" im Formular: `paket-sh-system.test.sh` hat aktuell 9 Einzeltests, nicht 20. Das lief lokal auf dem Server, nicht auf dem Mac (kein Mac-Zugriff von hier). Bitte prüfen, ob die 20 aus einem älteren Stand des Tests stammt oder ob auf dem Mac tatsächlich eine Fassung mit mehr Tests existiert.

## 4) Git für engineering/

Gewählter Weg: Unterordner im Hermes-Repo (`sundartha/hermes`), wie von dir bevorzugt — kein eigenes Repo nötig, da ein normaler Zugriff auf das Repo und den Standardweg vorhanden ist.

Umgesetzt:
- GitHub-Issue eröffnet (Schritt 1 des Standardwegs): https://github.com/sundartha/hermes/issues/5765 — mit Absicht/Warum, Abnahmekriterien (Ordner als Unterordner, eine `paket.sh`-Quelle, Tests grün aus dem Repo-Pfad, keine Löschungen, laufende Ketten unangetastet), Nicht-Zielen (kein `src/`, kein Live, kein Löschen).
- `.gitignore`-Vorschlag im Ordner selbst abgelegt (`engineering/.gitignore`, noch nicht committet): schließt `ketten/`, `wache/`, `kennzahlen/`, `pruefsatz/`, Logs, `.env`/Zugangsdaten, `*.bak*`- und `*vor-*`-Kopien aus.
- Tatsächlich gezählte Kopien im Ordner: 13 `paket.sh.*`-Dateien (nicht ~60 wie im Formular geschätzt) — grober Richtwert, keine davon wurde angefasst oder gelöscht.

Nicht umgesetzt, bewusst: der eigentliche Umzug der Dateien ins Repo (Bau-Agent im Worktree, PR, Prüfer-Urteil, Merge-Queue). Das ist laut eurem „Standardweg" ein eigener, mehrstufiger Ablauf mit eigenen Häppchen (Issue → Plan → Bau → PR → Urteil → Merge) und würde, wenn ich ihn selbst anstoße, einen Hintergrundprozess starten, der über das Ende dieses Auftragslaufs hinaus läuft — das ist mir für diesen Lauf nicht erlaubt. Nächster Schritt: eine Kette auf Issue #5765 starten (normaler Paket-Ablauf), die den Umzug in einem oder mehreren Häppchen umsetzt.

## Offene Rückfrage an dich

Hast du auf deinem Mac tatsächlich eine eigenständige, 244 Zeilen große `paket.sh` mit `lockf`, die vom Server-Stand abweicht? Falls ja: bitte eine Kopie davon hierher bringen (z. B. Inhalt einfügen oder als Datei bereitstellen) oder den Befehl `diff /Users/antonio/Bereiche/sundartha/engineering/paket.sh <server-pfad>` direkt auf dem Mac laufen lassen und die Ausgabe schicken — ohne das kann ich den inhaltlichen Unterschied nicht ermitteln, weil dieses System keinen Zugriff auf deinen Mac hat.
