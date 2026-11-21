## Zusammenfassung (für Antonio)

Der Fehler, der die Kette #5006 über 800 Runden lang im Kreis drehen ließ, ist behoben. Die Kette erkannte zwar, dass ein Paket freigegeben werden sollte, aber wenn das nicht klappte (weil ein Test rot war), gab es keine Bremse – sie versuchte es einfach immer wieder, ohne Ende. Jetzt zählt die Kette mit, wie oft sie das für denselben Stand hintereinander versucht, und hält nach drei vergeblichen Versuchen mit einer klaren Meldung an, statt weiterzudrehen. Belegt ist das durch einen neuen, automatisierten Test, der genau diesen Fall nachstellt und vorher rot, jetzt grün ist; die bestehenden Tests laufen unverändert grün weiter. Offen ist nichts an diesem Fehler selbst – die betroffene Kette #5006 war schon vorher von jemandem angehalten worden und musste nicht zusätzlich gestoppt werden. Antonio muss nichts tun, außer bei Gelegenheit den roten Test hinter PR 5311 (der ursprüngliche Auslöser) klären zu lassen.

## Technischer Befund

`freigeben()` in `paket.sh` hält bei eigenem Scheitern (Approve/Merge schlägt fehl) bereits selbst an – das war nicht die Lücke. Die eigentliche Lücke: `eingereiht()` gilt schon als erfüllt, wenn GitHub Auto-Merge nur *vorgemerkt* hat (Pull Request im Status „wartet auf grüne Checks“), auch wenn die Checks seit Stunden/Tagen rot bleiben und sich nichts mehr ändert. Dadurch „gelingt“ `freigeben $PR` aus Sicht der Kette, ohne dass je ein Merge passiert – und die `while true`-Schleife (Zeile 160) läuft im Zweig „bau-$N übersprungen“ unbegrenzt weiter, weil dort keine Obergrenze existierte.

Fall: PR 5311, Kette #5006, 18.11. ~23:00 bis 19.11. 01:04, über 800 Runden „bau-N übersprungen“, Ursache ein roter Pflicht-Test (`test/werkzeuge/staging-deploy-vorfall.test.js:226`). Die Kette wurde zwischenzeitlich von anderer Stelle manuell angehalten (`halt.txt` in `ketten/paket-5006` vorhanden, Prozess nicht mehr aktiv).

## Änderung

Datei: `~/Bereiche/sundartha/engineering/paket.sh`, Zeile 163 (im Zweig „PR hat PASS auf unverändertem Kopf“).

Vorher:
```
echo "bau-$N übersprungen: PR $PR hat PASS auf unverändertem Kopf" >> $LOG/fortsetzen.txt; read _ MIG <<< "$(einstufung $PR)"; [ "$MIG" = - ] && freigeben $PR
```

Nachher:
```
echo "bau-$N übersprungen: PR $PR hat PASS auf unverändertem Kopf" >> $LOG/fortsetzen.txt; if [ "$(tail -1 $LOG/uebersprungen.txt 2>/dev/null | cut -d' ' -f1-2)" = "$PR $PRK" ]; then ANZ=$(( $(tail -1 $LOG/uebersprungen.txt | cut -d' ' -f3) + 1 )); else ANZ=1; fi; echo "$PR $PRK $ANZ" >> $LOG/uebersprungen.txt; [ "$ANZ" -gt 3 ] && { echo "PR $PR: PASS auf unverändertem Kopf, aber Freigabe scheitert (Checks rot?)" > $LOG/halt.txt; exit 1; }; read _ MIG <<< "$(einstufung $PR)"; [ "$MIG" = - ] && freigeben $PR
```

Neue Zustandsdatei je Kette: `$LOG/uebersprungen.txt` (Zeilen „PR Kopf Zähler“), zählt aufeinanderfolgende Runden mit demselben PR+Kopf; bei neuem Kopf (Rebase, Nachbesserung) setzt sich der Zähler automatisch zurück, da der Vergleich `tail -1 ... = "$PR $PRK"` fehlschlägt.

Minimal gehalten: keine neue Prüfstation, keine neue Kettenphase, keine Änderung an `freigeben`, `pass_auf_kopf`, `prj` oder anderen Stellen. Alle `# LAGE-1115`-Markierungen (9 Stück) unverändert (per `diff` gegen Sicherung geprüft).

## Vorgehen

1. Funktionen `freigeben`, `pass_auf_kopf`, `prj`, `eingereiht`, `einstufung` gelesen und die Ursache identifiziert (siehe oben).
2. `paket.sh.bak-20261119-schleife` als Sicherung der alten Fassung angelegt.
3. Änderung in `paket.sh.neu` (Kopie) vorgenommen, nie in `paket.sh` selbst.
4. `zsh -n paket.sh.neu` → Syntax OK.
5. Test ergänzt in `paket-sh-system.test.sh`: zwei neue `pruefe`-Fälle extrahieren die geänderte Zeile per `grep -o` direkt aus dem Skript (wie beim bestehenden `SCHLEIFE`-Test) und führen sie mit Testdoppeln für `freigeben`/`einstufung` fünfmal in Folge aus – Erwartung: ab der vierten Runde hält die Kette; ein neuer Kopf setzt den Zähler zurück.
6. Test gegen die alte Fassung (`paket.sh.bak-20261119-schleife`) laufen lassen: wie erwartet ROT (Beleg für den Fehler). Gegen `paket.sh.neu`: GRÜN.
7. Alle drei Testdateien (`paket-sh-system.test.sh`, `paket-pr-system.test.sh`, `paket-lesung.test.sh`) gegen `paket.sh.neu` laufen lassen: alle grün, exit 0.
8. `mv paket.sh.neu paket.sh` (atomar, Zieldatei existierte, kein kurzzeitiges Fehlen für laufende Ketten).
9. `zsh -n paket.sh` nach dem `mv` erneut geprüft: OK. Alle drei Tests nochmal gegen die jetzt aktive `paket.sh` laufen lassen: alle grün.
10. Kette `paket-5006` geprüft: `halt.txt` vorhanden, Prozess (PID 6545) nicht mehr aktiv – keine laufende Kette, die während des `mv` die Datei gelesen hätte, betroffen.

## auftrag_fertig – diff-Auszug

```
--- paket.sh.bak-20261119-schleife
+++ paket.sh
@@ -160,7 +160,7 @@
 while true; do N=$((N + 1))   # ...
   PR=$(tail -1 $LOG/pass.txt 2>/dev/null | cut -d' ' -f1)
   if [ -n "$PR" ] && prj $PR && [ "$PRS" = "OPEN" ] && pass_auf_kopf $PR $PRK; then
-    echo "bau-$N übersprungen: ..." >> $LOG/fortsetzen.txt; read _ MIG <<< "$(einstufung $PR)"; [ "$MIG" = - ] && freigeben $PR
+    echo "bau-$N übersprungen: ..." >> $LOG/fortsetzen.txt; if [ "$(tail -1 $LOG/uebersprungen.txt ...)" = "$PR $PRK" ]; then ANZ=$((...+1)); else ANZ=1; fi; echo "$PR $PRK $ANZ" >> $LOG/uebersprungen.txt; [ "$ANZ" -gt 3 ] && { echo "PR $PR: PASS auf unverändertem Kopf, aber Freigabe scheitert (Checks rot?)" > $LOG/halt.txt; exit 1; }; read _ MIG <<< "$(einstufung $PR)"; [ "$MIG" = - ] && freigeben $PR
   else
```

Tests: `paket-sh-system.test.sh` (+2 Fälle), unverändert sonst. Alle Testläufe grün (9/9, 3/3, 3/3). `zsh -n` vor und nach `mv` OK. Sicherung: `paket.sh.bak-20261119-schleife`.

ERGEBNIS: /home/ubuntu/Bereiche/sundartha/engineering/ERGEBNIS_A-DKAUPW.md - paket.sh hält jetzt nach 3 erfolglosen Freigabe-Versuchen auf demselben PR-Kopf statt endlos zu drehen, mit neuem Test belegt und atomar über die alte Fassung gelegt.
