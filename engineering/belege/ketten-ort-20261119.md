# Wo laufen die Ketten? Messung 19.11.2026 20:23
SERVER (hostname ip-172-31-42-110): `pgrep -af paket.sh` -> keine Ausgabe (0 Prozesse).
MAC (hostname MBP-von-Antonio): pgrep paket.sh -> PIDs 25939, 47736, 48021, 52525, 52526, 55103, 56876, 60009, 74347, 78867 (10 PIDs).
4308: PID 47736 ist Kindprozess (PPID 60009) von 60009, kein Doppellauf; eine Kette.
Einordnung: lage liest Ketten aus den Ordnern; die Mac-Ketten werden alle 2 min auf den Server gespiegelt, deshalb tauchten sie bei lage-Aufrufen auf dem Server auf. Die Meldung 16:12 "8 Ketten auf dem Server" zählte gespiegelte Mac-Ketten bzw. Prozesse aus lage ohne Ortsangabe; ein ps vom Server aus 16:12 liegt nicht vor. Jetzt gilt: Prozesse laufen nur auf dem Mac.
