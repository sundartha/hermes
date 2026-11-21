# Wackler-Messung 20.11.2026 (Formular A-Q6SD4H)

Gemessen am 20.11.2026 gegen GitHub (sundartha/hermes), nur lesend, ohne lokale Testläufe.

## Ergebnis in zwei Sätzen
- **Alte Wackler: 15 Issues offen** (Titel „Wackelig: …“, Anlegedatum 06.10.–06.11.), dazu 1 offenes Prüfer-Issue (#3030), das ein Workflow-Befund und kein Wackeltest ist. Von den 15 zeigen 8 auf eine Testdatei, die am Pfad aus dem Titel nicht mehr existiert (gelöscht oder verschoben; nicht weiter geprüft, ob der Wackler damit weg ist). Keines der 15 ist mit einem gemergten PR verknüpft.
- **Neue Wackler: Sperre gegen die klassischen Zeit-Wackler ja, gegen Rennen/Last-Wackler nein.** In den letzten ~31 h sind 11 verschiedene Testdateien nach Neulauf grün geworden; die meisten davon stehen nicht auf den Listen der geduldeten Zeit-Verstöße. Die Sperre greift also, aber die Wackler kommen überwiegend aus anderer Quelle (Rennen, Last, Datenbank).

## 1. Wackel-Issues (Titel oder Label „wackelig/Wackel“)
Gefunden: 23 Issues (21 mit Label `wackelig`, 2 nur per Titel), dazu 3 weitere Wackler-Issues ohne diese Wörter im Titel (#5350, #5137, #4878).

**Offen (16):** #838, #1208, #1426, #1534, #1566, #1666, #1786, #2036, #2136, #2158, #2290, #2412, #2500, #2754, #3199 (alle „Wackelig: test/…“) und #3030 (Prüfer-Befund zum Workflow wackel-probe-wpp, PR #3028 ist gemergt).
- Testdatei aus dem Titel existiert nicht mehr: #838, #1426, #1534, #1666, #2036, #2136, #2158, #3199.
- Datei existiert und wurde seit Issue-Anlage geändert, aber nicht als Wackel-Fix erkennbar: #1208, #1566 (store-pg, **ist in den letzten 48 h selbst wieder rot-dann-grün geworden**), #1786, #2290, #2412, #2500, #2754.

**Geschlossen mit gemergtem PR:**
| Issue | PR (gemergt) |
|---|---|
| #410 | kein PR per Suche auffindbar (Suche liefert nur Zufallstreffer) |
| #2298 | #4984 (17.11.) |
| #2313 | #2319 (28.10.) |
| #4050 | #5487 (19.11.) |
| #4878 | #5488 (19.11.) |
| #5137 | #5491 (20.11.) |
| #5465 | #5468 (19.11.) |
| #5472 | #5474 (19.11.) |
| #5082 (Lastlauf, kein Testwackler) | #5089, #5120 |
| #5350 | geschlossen, aber per Suche kein verknüpfter PR gefunden (nicht geklärt) |

Die Zuordnung Issue→PR beruht auf der GitHub-Textsuche nach der Nummer, nicht auf der Closing-Verknüpfung (die konnte ich mit der CLI hier nicht abfragen). Sie kann Treffer übersehen.

## 2. Flake-Spuren in den CI-Läufen
Datenbasis: Workflow-Läufe „CI“ seit 19.11. 05:54 UTC bis 20.11. 12:16 UTC (die Abfrage lieferte höchstens 1000 Läufe, also **nur ca. 31 h statt 48 h**). 272 Commits; 31 davon mit mehr als einem Versuch oder rot und später grün. Als Flake-Spur zähle ich: Lauf-Versuch 1 rot, derselbe Lauf (Neulauf) später grün.
Fehlerursachen aus den Job-Logs der roten Versuche gelesen (Testname steht dort).

| Testdatei | Spuren (rot→grün am Neulauf) | seit wann/Fix-Stand |
|---|---|---|
| test/anrufe/webhook-zustellung-nachlauf-zweifach.test.js | 3 (19.11. 06:59, 20.11. 03:29, 20.11. 05:06) | Fix-Commits am 19.11. 03:12, 04:18 und 20.11. 00:00 auf master; Spuren 03:29 und 05:06 liegen danach, ob der PR-Stand den Fix schon hatte, habe ich nicht geprüft → **vermutlich nicht gefixt** |
| test/utils/anbieter-aufrufe-reservierung-verbrauch.test.js | 1 Commit, 2 Versuche rot, erst Versuch 3 grün (19.11. 17:13) | letzte Änderung 13.11. → **nicht gefixt** |
| test/gemeinsam/store-pg.test.js (addNotification kappt auf 50; erwartet 50, erhalten 49) | 1 (19.11. 06:57) | Issue #1566 offen seit 19.10. → **nicht gefixt** |
| test/anrufe/schutz-limits-neustart-postgres.test.js (PG „terminating connection due to administrator command“) | 1 (20.11. 11:49) | letzte Änderung 07.11. → **nicht gefixt, kein Issue gefunden** |
| test/ausfallproben/ausfallprobe-postgres-neustart-meldet-gruen-oder-rot.test.js | 1 (20.11. 01:04, 2 rote Fälle) | letzte Änderung 12.11. → **nicht gefixt, kein Issue** |
| apps/web/test/consent-dom.test.js (astro build schlägt fehl, 4 rote Fälle) | 1 (19.11. 21:05) | letzte Änderung 06.11. → **nicht gefixt, kein Issue** |
| test/anrufe/fristen-abfrage-boot-json.test.js | 1 (19.11. 14:36, erwartet 1, erhalten 2) | geändert 18.11. 19:06 (Fix-Absicht nicht bewiesen) → offen |
| test/einstellungen/lesen-zwei-instanzen.test.js (404 kein_laufender_anruf) | 1 (19.11. 14:31) | letzte Änderung 17.11. → **nicht gefixt** |
| test/ausfallproben/ausfallprobe-alle-meldet-gesamtergebnis.test.js | 1 (19.11. 11:12) | #5465 gefixt, PR #5468 gemergt 19.11. 12:12 → **gefixt** (seither keine Spur in meinen Daten) |

Dazu die Mutations-Jobs: In mindestens 3 Mutations-Läufen (Neulauf grün) steht „Basis rot: … zweimal ohne Mutant rot“ für test/anrufe/kanalgrenze-widget-pins.test.js, test/gemeinsam/openai-p8-widget-ui.test.js, test/gemeinsam/openai-t2-02-widget-uris.test.js und test/gemeinsam/mcp-kompatibilitaetsvertrag.test.js (Karte 52a826b9 „fünf Testdateien“ ist dieselbe Spur). Außerdem ein Lauf (44573555455) mit 7 von 20 Mutations-Teilen rot, erst im 4. Versuch grün. Ein Rotprobe-Job (Lauf 44677622957, 20.11. 04:57) und einer in Lauf 44716556011 waren rot und beim Neulauf grün; Ursache nicht aus dem Log gelesen.
→ Diese vier Dateien: **nicht gefixt** (Karte 52a826b9 offen).

**Nicht gemessen:** Läufe vor 19.11. 05:54 UTC; PR-Läufe, die per Merge-Queue-Gruppe liefen und deren Versuche in anderen Workflow-Namen stecken; ob ein roter Versuch ein echter Fehler war, den der Neulauf nur zufällig nicht mehr traf (ich habe nur geprüft: rot → später grün am selben Lauf, nicht, ob der Commit-Inhalt gleich blieb); Läufe, die „cancelled“ endeten.

## 3. Sperre gegen neue Wackler
Quelle: eslint.config.js und tools/basis/zeitglieder-bestand.json auf master (live gelesen).
- **Zeit nur über die gemeinsame Uhr (Tests):** Regel „uhr-in-tests“ sperrt `Date.now`, `new Date()` ohne Argument, `performance.now`, `process.hrtime` in test/** mit Hinweis auf test/fake-clock.js und t.mock.timers. Geduldet sind 322 Altdateien (Liste UHR_TESTS_BESTAND); neue Dateien fallen darunter.
- **Warten auf Ereignis statt sleep (Tests):** Regel „zeitglieder-in-tests“ sperrt `setTimeout`, `setInterval`, `Atomics.wait` und Importe von node:timers (auch /promises) in test/**; Ausnahmen nur 3 Hilfsdateien und 47 Altdateien (zeitglieder-bestand.json).
- **Quelltext Anrufbereich:** „uhr-als-wert“ sperrt Date.now, setTimeout, sleep usw. in der Fachlogik; Verhaltenstests dafür: test/gemeinsam/uhr-in-tests-lint.test.js, uhr-warten-lint.test.js, uhr-als-wert-lint.test.js.
- **Greift sie?** Die Regeln sind in der Lint-Konfiguration aktiv und haben eigene Verhaltenstests. Dass sie einen konkreten PR abgelehnt hätten, habe ich **nicht** gemessen. Hinweis: Von den 9 geflakten Dateien stehen webhook-zustellung-nachlauf-zweifach, anbieter-aufrufe-reservierung-verbrauch, ausfallprobe-postgres-neustart, fristen-abfrage-boot-json und store-pg.test in der Uhr-Altliste (geduldet, Namenstreffer in eslint.config.js); die übrigen vier sind nicht dort aufgeführt, wackeln also trotz Sperre.
- **Was fehlt (nur Vorschlag, keine neue Station):**
  1. Die Wackler der letzten 31 h sind überwiegend **Rennen und Last** (Postgres-Verbindung gekappt, zwei gleichzeitige Anrufe, astro build, Anspruchsverbindung vor/nach Fortsetzen, Mutations-Umgebung), nicht Uhr/sleep. Dafür gibt es keine Sperre; dort hilft nur ein erlaubter Weg im Test (z. B. gemeinsame Hilfsfunktion „warte auf Ereignis“ oder Datenbank-Hilfe), kein Verbot.
  2. Die Altlisten (322 + 47 Dateien) schrumpfen nur, wenn jemand sie abbaut; sie sind das größte offene Wackel-Risiko im Bestand. Vorschlag: im vorhandenen Lint-Platz festschreiben, dass die Listen nur kleiner werden dürfen (bestand.js scheint das für Befunde schon zu können; ob für diese beiden Listen, nicht geprüft).
  3. Ein rot→grün-Neulauf erzeugt kein Issue und keinen Eintrag: 8 der 9 Spuren oben haben kein offenes Issue. Der vorhandene Platz dafür wäre die Warteschlangen-Erkennung aus PR #1506 (WKT) oder die Mutations-/Testschutz-Auswertung; ob WKT bei dieser Art Neulauf auslöst, ist **nicht geprüft**.

## Grenzen dieser Messung
Nur GitHub-Daten, nur ~31 h, keine Testläufe, Issue→PR-Zuordnung per Textsuche, Flake = rot→grün am selben Lauf. Ob die 15 alten Issues noch real wackeln, ist nicht gemessen; 8 davon zeigen auf eine nicht mehr vorhandene Datei.
