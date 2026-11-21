# Lastampel mit Zwischenstufe (Karte f842ce73, Paket 2 von Auftrag 0968dba1) – 19.11.2026 13:50

## Befund
1. Vorher: Die Ampel kannte nur frei/voll; „voll“ schon bei Last >4 (Server) oder Auslagerung >5 MB/s und erst 10 Min. am Stück darunter wieder frei. paket.sh MAX_KETTEN=0: jeder Start ging in die Warteschlange, der Mac holt per bau-abgeben.sh.
2. Frühere Belege gelesen: paket1-cgroup.txt (Ketten in eigener Gruppe, keine Änderung nötig), server-testbau-20261118.md; geschlossene PRs zu „lastampel“: keine (gh liefert nichts). Die Ampel steuert nur Wache/Verteiler (Nachschub), nicht die Kettenzahl – die steht allein in paket.sh.
3. Änderung (ein Experiment): drei Stufen. frei = Server nimmt bis 2 Ketten; „belegt“ (über alter Schwelle, aber keine echte Überlast: Last ≤ 8, Auslagerung ≤ 25 MB/s, Druck-Stufe 1) = Server nimmt keine neue Kette, Überlauf auf den Mac, KEINE 10-Min.-Sperre, zustand bleibt „frei“ (Wache/Verteiler bremsen nicht); „voll“ nur bei echter Überlast (Druck ≥2, Last >8, Auslagerung >25 MB/s) mit alter Sperre. Messfehler/Not-Aus = 0 Server-Ketten.
4. paket.sh: MAX_KETTEN=2 als Obergrenze, GRENZE = min(2, lastampel.py --ketten); Fehler der Ampel = 0 (also wie bisher alles auf den Mac). bau-abgeben.sh schreibt jetzt die Wartezeit (Minuten Warteschlange→Abgabe) und die Restschlange in paket-<nr>/auf-mac.txt.
5. Test: test_lastampel.py 18/18 grün (drei neue Fälle: belegt ohne Sperre, echte Überlast mit Sperre, Messfehler/Not-Aus = 0). Zwei Altfälle waren auf dem Server schon vorher rot (Mac-Schwellen fest eingetragen) und sind jetzt schwellenneutral.

## Messwerte
Vorher (18.11. 22:50 bis 19.11. 13:50, lastampel.log): 7 Wechsel auf „voll“, zusammen 216 Min. voll in ca. 15 Std. Server-Ketten in dieser Zeit: immer 0 (MAX_KETTEN=0). Warteschlange jetzt: 0 Einträge; eine Wartezeit-Aufzeichnung gab es vorher nicht (Eintrag wird beim Abholen gelöscht, auf-mac.txt trug nur den Startzeitpunkt) – Wartezeit vorher daher nicht nachträglich messbar.
Rückrechnung der 7 Episoden nach neuen Regeln (aus den Protokollwerten): 5 wären nur „belegt“ gewesen (Auslagerung 4,7–5,8 MB/s bzw. Last 5,0–6,9; zusammen 127 von 216 Min. ohne Sperre und ohne Bremsen), 2 weiter „voll“ (Last 9,1/9,3). Zwischen den Episoden (frei) hätte der Server bis 2 Ketten genommen statt 0.
Nachher: Server-Kettenzahl live 0 (Ampel steht noch in der alten 10-Min.-Sperre; Wechsel in ca. 10 Min.). Wartezeit/Schlange nachher: noch nicht gemessen – es hat seit der Änderung keine Kette gestartet; ab jetzt steht „wartezeit_min N schlange_rest M“ in ketten/paket-<nr>/auf-mac.txt (nur bei Abgabe an den Mac; Server-Direktstart hat Wartezeit 0).

## Entscheidung
BEHALTEN (vorläufig, Messung offen): kleinster Schritt, Rücknahme mit einer Zeile (MAX_KETTEN=0 in paket.sh, bei Ampel-Fehler ohnehin 0); Risiko Server-Speicher (8 GB, Last im Leerlauf schon ~3,7) wird durch „belegt = 0 Ketten“ und die Obergrenze 2 begrenzt. Nach den ersten ~5 Kettenstarts prüfen: Server-Auslagerung/Gateway-Hänger und Wartezeiten in auf-mac.txt; bei Auslagerung >25 MB/s oder Gateway-Hänger: MAX_KETTEN=0.

## Geänderte Dateien (Sicherungen mit Zeitstempel 20261119-1346)
- ~/Bereiche/openclaw/lastschutz/lastampel.py (.bak-20261119-1346)
- ~/Bereiche/openclaw/lastschutz/test_lastampel.py (.bak-20261119-1346)
- ~/Bereiche/sundartha/engineering/paket.sh (paket.sh.bak-20261119-1346-zwischenstufe; atomar ersetzt)
- ~/Bereiche/openclaw/cloud/bau-abgeben.sh (.bak-20261119-1346)
Keine neue Station, kein Hook, kein Workflow. Hinweis: die Mac-Kopie von bau-abgeben.sh/paket.sh (falls getrennt gepflegt) ist nicht angefasst.
Braucht Antonio: nein (Server-Ketten von 0 auf bis 2 ist seine frühere Einstellung von 3 zurückgenommen; falls er MAX_KETTEN=0 ausdrücklich so will, Rücknahme siehe oben).
