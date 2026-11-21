## Zusammenfassung (für Antonio)

Ein konkreter Wackelmacher in den Tests ist jetzt behoben: Ein gemeinsamer Test-Helfer, den 15 verschiedene Testdateien nutzen (Login, Rechnungen, Telefonnummern, Telnyx), hat bisher immer 20 Millisekunden echte Zeit gewartet, bevor er einen simulierten Zeitablauf auslöste. Unter Last auf dem Server konnte das zu früh passieren, bevor der Test überhaupt bereit war – dann blieb der Test hängen, bis die große Zeitgrenze zuschlug, und lief als "rot" oder "wackelig" durch. Jetzt löst der Helfer das sofort im nächsten Arbeitsschritt aus, ganz ohne echte Wartezeit – das macht ihn zuverlässig und sogar schneller. Ich habe das an allen 18 betroffenen Testdateien lokal mehrfach geprüft (221 Einzeltests, alle grün, auch bei fünffacher Wiederholung stabil), ein GitHub-Issue mit der Ursachenanalyse angelegt und einen Pull Request dafür eröffnet. Die automatische Prüfung (CI) läuft gerade noch auf GitHub. Offen und für dich zu wissen: Die größere Liste der noch verbleibenden "echten Wartezeiten" in den Tests (9 weitere Stellen) hängt an echten Datenbank-, Mail- oder Mess-Prozessen und lässt sich nicht einfach mechanisch umstellen – jede davon braucht eine eigene Prüfung, das ist bewusst nicht in diesem ersten Schritt mit angefasst. Zusätzlich tauchte heute (21.11.) ein frischer, unabhängiger Wackler in den Telefon-Webhook-Tests auf (Postgres-Transaktionsrennen) – der hängt nicht an festen Wartezeiten und ist nicht Teil dieses Auftrags, aber als Fundstelle im Issue vermerkt.

## Auftrag und Einordnung

Formular A-W2W5PV, Bezug Workboard-Karte 688de8ec-8893-452e-b805-013fce460492 (Auftrag 0686308a): "Wackeltests sollen ihre festen Wartezeiten durch die gemeinsame Test-Uhr ersetzen." Aufgabe: erstes Häppchen bauen (Ursachen der Wackler, Tests über die gemeinsame Uhr).

Hinweis zur Umgebung: Der Auftrag nennt den Mac-Pfad `/Users/antonio/Mein Unternehmen/MCP/vodafone-agent`. Diese Sitzung lief auf dem Linux-Server; dort liegt derselbe Checkout unter `/home/ubuntu/Mein Unternehmen/MCP/wt-steuerung` (Remote `hermes` = `github.com/sundartha/hermes`, laut `CLAUDE.md` im Repo heißt das Verzeichnis historisch noch `vodafone-agent`). `STANDARDWEG.md` unter dem genannten Pfad existiert auf diesem Server nicht; die `CLAUDE.md` im Repo selbst beschreibt denselben Standardweg (Issue → Plan → Bau im eigenen Worktree → Push/PR → Urteil → Merge) und wurde als Grundlage genommen.

## Ursachen der Wackler (Analyse)

1. Die automatische Wackler-Erfassung des Repos (GitHub-Issues mit Label `wackelig`) listet laufend neu erkannte wacklige Tests. Innerhalb der letzten 7 Tage gab es u. a. mehrfache Treffer in `test/anrufe/webhook-zustellung-nachlauf-zweifach.test.js` (Issues #5730, #5735, beide 21.11.) – deren Ursache liegt an echten Postgres-Transaktionen/einem pausierbaren DB-Relais, nicht an festen Wartezeiten; das ist ein eigenes Thema und hier nicht angefasst.
2. Der Repo hat bereits eine etablierte "gemeinsame Uhr" (`test/fake-clock.js`, `jumpClock`) für Fälle, die eine steuerbare Uhr brauchen, sowie eine Bestandsliste `tools/basis/echte-wartezeiten.json` aller Testdateien, die noch echte Wartezeit (`echtWarten` aus `test/echt-warten.js`) benutzen dürfen (eine ESLint-Regel sperrt neue Verwendungen außerhalb dieser Liste). Das ist genau der Hebel, den der Auftrag meint.
3. Von den 10 Einträgen dieser Liste war `test/gemeinsam/kurze-antwortfrist.mjs` der einzige, dessen echte Wartezeit (20 ms) reine Verkabelung war und kein geprüftes Verhalten: Kein einziger der 15 Tests, die den Helfer nutzen, prüft die Dauer – nur, dass ein simulierter Fristablauf irgendwann mit dem richtigen Grund ankommt. Diese 20 ms waren eine Wette auf die CI-Last: Braucht der aufrufende Code länger als 20 ms, um seinen Abbruch-Listener anzuhängen, feuert der Abbruch zu früh, der Listener verpasst das Ereignis (keine Nachlieferung bei bereits ausgelöstem `AbortSignal`), und der Test hängt bis zur großen Zeitgrenze – ein klassischer Wackler-Mechanismus.
4. Die übrigen 9 Einträge der Liste hängen an echter externer I/O (Postgres-Start, Mail-Neustart, zwei Postgres-Instanzen, Eltern-Prozess-Wächter, OTLP-Messexport, Event-Loop-/Datenbank-Lebenszeichen, Posteingangs-Onboarding-Polling) bzw. prüfen bewusst ein reales Zeitfenster. Diese lassen sich nicht mechanisch auf eine simulierte Uhr umstellen, ohne den jeweiligen Produktionscode oder das Testdesign eigenständig zu überdenken – das sind eigene, größere Häppchen.

## Gebautes erstes Häppchen

- `test/gemeinsam/kurze-antwortfrist.mjs`: Fristablauf wird nicht mehr über `echtWarten(20)` ausgelöst, sondern über `setImmediate` (nächster Tick, kein Bezug mehr auf echte Zeit). Verhalten für alle Aufrufer bleibt gleich (asynchroner Abbruch mit demselben Grund).
- `tools/basis/echte-wartezeiten.json`: Eintrag gestrichen (Liste jetzt 9 statt 10 Einträge).
- Geprüft: alle 18 betroffenen Dateien (ermittelt mit `node tools/pruefen.mjs betroffen`) einzeln lokal ausgeführt – 221 Tests, 0 rot; vier davon zusätzlich 5× wiederholt, stabil grün und spürbar schneller als vorher. `lint`, `typen`, `bestaende`, `architektur`, `katalog` lokal grün, keine neuen oder gewachsenen Einträge in den eingefrorenen Beständen.
- `testschutz` meldet erwartungsgemäß rot, weil bestehende Zeilen in `kurze-antwortfrist.mjs` geändert wurden; das Verhalten bleibt aber gleich, nur die Auslöse-Mechanik. Laut Standardweg setzt das Label `verhalten-geaendert` nur das Urteil, nicht der Bau – das habe ich nicht selbst gesetzt.

## Belege

- Issue: https://github.com/sundartha/hermes/issues/5756
- Pull Request: https://github.com/sundartha/hermes/pull/5761 (Branch `paket/5756-kurze-frist-ereignis`, eigener Worktree `.claude/worktrees/paket-5756-kurze-frist-ereignis` im Hauptrepo, Hauptcheckout nicht verändert)
- CI auf dem PR lief beim Abschluss dieses Berichts noch (alle Checks "pending", u. a. Prüfungen, Tests 1–12, Abdeckung 1–12, Rotprobe, Mutation, Semgrep, CodeQL, Freigabe-Prüfung, Testschutz) – bitte später mit `gh pr checks 5761` nachsehen.

## Was fehlt / offen

- CI-Ergebnis für PR #5761 steht noch aus; kein Urteil, kein Merge durch mich (gehört nicht zu diesem Auftrag).
- Die 9 verbleibenden Einträge in `tools/basis/echte-wartezeiten.json` sind NICHT Teil dieses Häppchens – jede davon braucht eine eigene Analyse/Design, wie im Issue #5756 unter "Nicht-Ziele" vermerkt.
- Der frische Wackler in `test/anrufe/webhook-zustellung-nachlauf-zweifach.test.js` (#5730, #5735, Postgres-Transaktionsrennen) ist nicht Teil dieses Auftrags und nicht behoben.
- Die größere "Wackelmessung" aus der Workboard-Karte (rote Tests der letzten 7 Tage nach Datei zählen, Wiederholungslauf-Quote über `gh run list`) habe ich nicht als separate Kennzahlen-Tabelle gebaut, weil das Repo dafür bereits eine automatische, laufende Erfassung über GitHub-Issues mit Label `wackelig` hat (aktueller, genauer als eine einmalige manuelle Auszählung); diese Liste habe ich für die Ursachenanalyse genutzt.
- `auftrag_zustand` für 0686308a/87bf90c4 auf "läuft" setzen und die Push-Prüfweg-Hälfte des Auftrags (Issue für Prozess-/Speicher-Grenze) sind nicht Teil dieses Formulars (A-W2W5PV) und wurden nicht angefasst.
