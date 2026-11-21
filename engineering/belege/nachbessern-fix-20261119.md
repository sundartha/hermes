# Nachbesserungsgrenze: falscher Halt behoben (A-VA2YWR, Karte f6ee18ab, 19.11.2026)

## Messung (Ketten-Ordner, 19.11. 23:05)
- 421 Ketten-Ordner insgesamt, 71 mit nachbessern.txt (mindestens ein Plan-Nachtrag aus der Bewertung).
- 23 Ketten erreichten für einen PR den Zähler 3 (2643, 2919, 2927, 2929, 2935, 2973, 3371, 3401, 3408, 3415, 3821, 4282, 4394, 4397, 4847, 4996, 4998, 5003, 5078, 5137, 5228, 5278, 5505).
- 12 Ketten haben den Halt "Nachbesserungsgrenze erreicht" in Halt-Dateien (aktuell oder archiv): 2919, 2921, 2927, 2929, 2958, 2973, 3403, 4284, 4847, 5137, 5228, 5505. Das sind etwa 3 % aller Ketten, aber fast jede zweite Kette mit drei Nachträgen.
- Geschlossene PRs mit Suchwort "Nachbesserung": Treffer sind Titeltreffer ohne Bezug zum Mechanismus (keine PR dazu); verwandtes offenes Issue #5212 (Nachtrag nur PR-Text) bleibt eigenständig.

## Ursache (paket.sh Z. 201-205 alt)
- Nachtrag wurde gezählt (nachbessern.txt) und ins Issue geschrieben, aber die vierte Bewertung (Zähler schon 3) wurde nirgends veröffentlicht; Halt-Text behauptete "Bau hat ihn nicht umgesetzt", ohne zu prüfen, ob der PR-Kopf sich geändert hatte.

## Änderung (paket.sh auf dem Mac, Sicherung paket.sh.vor-nachbessern-fix-20261119; LAGE-1115-Stellen unverändert: 9 vorher, 9 nachher)
1. Die letzte Bewertung steht immer im Issue: weiter als "Plan-Nachtrag ...", vor dem Halt als Kommentar "Paket hält bei PR #..: <Grund>. Letzte Bewertung (nicht umgesetzt): ..." (beginnt mit "Paket hält", gilt damit nicht als Plan-Nachtrag/Schnitt).
2. Zu jedem Nachtrag merkt sich die Kette den PR-Kopf (nachbessern-kopf.txt, neue Datei im Ketten-Ordner, kein neues Skript). Ist der Kopf beim nächsten Mal unverändert, wurde der Nachtrag nicht umgesetzt und der Halt sagt das. Sonst zählen nur umgesetzte Nachträge; beim vierten kommt "Grenze erreicht (dreimal umgesetzt, Befunde bleiben)".
3. halt.txt nennt den echten Grund und verweist auf das Issue.

## Test (paket-sh-system.test.sh, Sicherung .vor-nachbessern-fix-20261119)
Fünf neue Fälle, alle ok: erster Nachtrag weiter; Kopf unverändert -> "nicht umgesetzt"; dreimal umgesetzt -> Grenze; zweimal umgesetzt -> weiter; Halt-Kommentar mit letzter Bewertung vorhanden. `zsh -n paket.sh` ok.

## Neustart #5137 (Konto 2)
- Halt-Dateien (halt.txt, halt-grund.txt, halt-neustarts.txt) mit /bin/mv nach ketten/paket-5137/archiv-1119f; nachbessern.txt (Zähler 3) bewusst nicht zurückgesetzt.
- Start 23:06, lage 23:07:57: "WARTET: wartet auf Pruefungen (Wiederholung) - bei ci", Prozess 22158 lebt (zsh ./paket.sh 5137 2).
- Offen: Ist beim nächsten Bewerten wieder ein Nachtrag nötig, hält die Kette ehrlich an der Grenze (Zähler 3, keine Kopf-Aufzeichnung für die alten Nachträge) und die Bewertung steht dann im Issue.
