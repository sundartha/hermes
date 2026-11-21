# Verteiler-Störung (A-TQDT6T) – gemessen 19.11.2026 15:10, nur lesend
1. Gemeldet von `lage` (~/Bereiche/openclaw/lage/lage.py:1566, Funktion verteiler_stoerung, Text „Verteiler hat seit … keinen Durchlauf mehr beendet“).
   Gemessen an `lage/cache/verteiler-lauf.json` (Feld `zeit`, schreibt der Verteiler nach jedem Durchlauf). Störung = Datei älter als 20 min (lage.py:60)
   oder ≥3 Abbrüche in Folge (lage.py:59); Gegenlesung: Rechner <20 min wach = keine Aussage (lage.py:1527).
2. Ausführung: verteiler.py (/Users/antonio/Documents/OpenClaw-Plugins/verteiler/, = /home/ubuntu/Documents/…) wird vom Gateway-Plugin angestoßen
   (Elternprozess: spawn-broker worker.js, PID 638088); kein Cron (`crontab -l`: leer), kein eigener systemd-Timer. Prozess 2005481 startete 15:09:42, Datei 15:08:57.
3. Logzeilen: verteiler-lauf.json 15:08:57 `ok:true, abbrueche_in_folge:0`. Protokoll ~/Bereiche/openclaw/verteiler-protokoll.log: Läufe alle 2 min bis 15:06.
   28 „ACHTUNG“-Zeilen seit 18.11. 22:25 (Linux-Umzug), letzte 14:45 „workboard.cards.list: gateway timeout after 10000ms“; frühere Lücken 19.11.: 09:20–09:32, 09:52–10:10, 10:37–11:05, 11:25–12:02.
   gateway-restart.log: Neustarts 18.11. 11:01Z und 21:45Z (= 12:01/22:45 MEZ).
4. Ursache (Satz): Die Meldung „seit 18.11. 10:48“ stammt aus dem alten Mac-Stand (Lauf-Datei dort vor dem Umzug stehengeblieben); der Verteiler auf dem Server läuft inzwischen,
   hatte zeitweise Lücken/Abbrüche durch Gateway-Zeitüberschreitungen (workboard.cards.list >10 s), die sich selbst erholt haben.
   Aktuell: `lage ketten` zeigt keine Störung (0 Treffer „STÖRUNG“), `lage antonio --alle` ebenfalls nicht.
5. Gateway-Neustart (gateway-neustart.sh --warten): jetzt NICHT nötig – Durchlauf ist frisch (<2 min alt), Störung nicht mehr gemeldet.
   Kleinerer Handgriff, falls sie wiederkehrt: erst `lage antonio` und `cat ~/Bereiche/openclaw/lage/cache/verteiler-lauf.json` prüfen; ist `ok:true` und `zeit` <5 min, ist die Meldung ein Altwert (Wecktext/Karte schließen).
   Bleibt sie echt (Datei >20 min alt oder Abbruch „gateway timeout“ in Folge), ist der Neustart der vorgesehene Weg (lage.py:1512, nur Antonio).
   Offen/ungeklärt: Ich fand die Quelle des konkreten „10:48“-Wecktextes nicht (keine Datei enthält ihn); die Lücken am Vormittag (Gateway-Timeouts) sind die wahrscheinliche Ursache der Meldung selbst.
