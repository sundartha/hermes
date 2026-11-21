# Push-Prüfweg: Messung 19.11.2026 16:30 (Auftrag 87bf90c4)
Quelle: GitHub Actions, Workflow ci.yml, Läufe seit 02:00 Ortszeit (01:00Z), abgeschlossen, nur lesend.
- 199 Läufe (Bedingung >=20 erfüllt): pull_request 79, merge_group 69, push 51.
- push (Push-Prüfweg): 51/51 grün, Median 5,0 min, p90 5,4 min.
- pull_request: 58 grün, 21 rot; Median 13,0 min, p90 20,1 min. 61 Zweige, 13 mit Wiederholung (Versuch >1); 1,3 Läufe je Zweig.
- merge_group: 60 grün, 9 rot (13 % rot); Median 10,6 min, p90 11,9 min.
Vergleich (belege/wackler-messung-20261119.md): Queue-Läufe rot 17.11. 183/436 (42 %), 18.11. 79/241 (33 %), 19.11. bis ~14 Uhr 14/74 (19 %).
Grenzen: Ich habe nicht gemessen, ob Prozess-/Speichergrenze oder die Prüfung gegen selbststartende Tests im Push-Weg gegriffen haben (keine Zählung der Abbrüche dieser Grenze); verglichen wird nur der Gesamtlauf. Ursache-Wirkung ist nicht belegt: heute liefen auch Wackler-Reparaturen und weniger Last.
