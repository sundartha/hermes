# 6-GB-Speichergrenze (paket-grenze) auf dem Mac, Messung 19.11.2026 20:38-20:45
Rechner: MBP-von-Antonio, 24 GB RAM, Last ca. 2, Swap belegt 17 von 18 GB (sysctl vm.swapusage, 20:45), 10 Ketten laufen.
Skript: messung/push-grenze/paket-grenze.kopie (gleich .bin/paket-grenze aus PR 4220; Standard GRENZE_GB=6, Takt 2 s, Messung ps rss).
Attrappe: Node-Prozess belegt 256 MB je Sekunde (Zufallsdaten), Notbremse bei 8 GB.

| Lauf | Grenze | Ergebnis |
|---|---|---|
| 1 | 1 GB (Probe, Füllung 0x01) | gestoppt, Exit 97, Meldung "1.1 GB", 0 Prozesse danach |
| 2 | 6 GB Standard, Füllung 0x01 (komprimierbar) | NICHT gestoppt: Attrappe erreichte 8 GB, Notbremse Exit 5 |
| 3 | 6 GB Standard, Zufallsdaten | NICHT gestoppt: 8 GB erreicht, Exit 5 |
| 4 | 3 GB, Zufallsdaten | gestoppt bei 3.3 GB, Exit 97 |
| 5 | 6 GB Standard, Zufallsdaten (wiederholt) | gestoppt bei 6.3 GB, Exit 97, 0 Prozesse danach |
Direktmessung ps rss einer gleichen Attrappe (ohne Wächter): rss folgt der Belegung (3.0 GB belegt = 3.05 GB rss).

Befund: Die Grenze greift (Läufe 1, 4, 5, Mechanismus und Standardwert 6 GB bewiesen), aber nicht verlässlich:
in den Läufen 2 und 3 blieb der gemessene Speicher unter 6 GB, obwohl 8 GB belegt waren. Vermutete Ursache (nicht bewiesen):
bei Speicherdruck und fast vollem Swap lagert macOS Seiten aus oder komprimiert sie; ps rss zählt sie dann nicht mehr.
Auf diesem Mac, der gerade Swap fast voll hat, ist rss damit eine zu niedrige Messgröße.
Rohausgaben auf dem Mac: /tmp/grenze-19/ (klein.log, gross.log, gross2.log, g3.log, g6.log).

# Nachtrag 20:55 – Umstellung auf phys_footprint (Auftrag A-R7CXHG)
Änderung: pakete-prompts/.bin/paket-grenze (Mac, ~/Claude/Projects/Agentic Calling MCP/pakete-prompts/.bin/), Sicherung paket-grenze.vor-footprint-20261119.
Neue Funktion speicherGb(): größere von Summe rss und Summe phys_footprint (`footprint --json <Datei> -p <pid>…`, zählt ausgelagerte und
komprimierte Seiten mit; Aufruf 0,02-0,04 s; nur auf macOS, sonst rss; bei Fehler Rückfall auf rss). Standardgrenze 6 GB unverändert.
Test (gleiche Attrappe, Zufallsdaten, Standardgrenze 6 GB, Swap beim Test 17-18 GB belegt):
- NEUE Fassung: 5 von 5 gestoppt (Exit 97 bei 6.3/6.3/6.4/6.4/6.3 GB, je 26-27 s, danach 0 Prozesse). Rohausgaben /tmp/grenze-19/n1..n5.log.
- ALTE Fassung unter denselben Bedingungen: 1 von 3 gestoppt, 2 von 3 NOTBREMSE bei 8 GB (a1..a3.log). Damit ist die Wirkung der Umstellung gezeigt.
Offen: Änderung liegt als uncommittete Datei im Repo pakete-prompts (nicht im Hermes-Repo); Commit dort macht der Hook nicht frei – nicht getan.

# Messwerte für die Frage zu 0968dba1 (Mac, 20:50)
Swap 20,6 von 21,5 GB belegt (um 20:38: 16,2 von 17,4 GB; um 20:45: 17,0 von 18,4 GB; der Swap wächst, meine Attrappen-Läufe haben dazu beigetragen, sind aber nicht die Ursache des Ausgangsstands).
RAM 24 GB; 10 Ketten (paket.sh) laufen, 8 claude-Prozesse = 0,8 GB rss, Summe aller Prozesse 6,5 GB rss, davon Chrome 2,2 GB, ollama 1,0-1,7 GB.
Pro Kette ca. 0,1 GB rss (claude-Sitzung); die Last liegt nicht bei den Ketten selbst, sondern bei den Testläufen und Browser/ollama; belegt ist nicht gemessen.

# Nachtrag: Versionierung (A-97H4Y7)
.bin liegt bewusst nicht im Hermes-Repo, sondern im lokalen Git-Repo pakete-prompts auf dem Mac (Zweig main, kein Remote). Die erste Fassung wurde dort
am 13.11. als Commit a044afa eingecheckt (nicht per PR). Die neue Fassung ist Commit da34e00 (nur .bin/paket-grenze, 17 Zeilen dazu, 1 geändert).
Es gibt für .bin keinen PR-Weg und keine Prüfungen; die Prüfung war der Attrappen-Test (5 von 5). Sicherung: nur die lokale Git-Historie auf dem Mac
und die Datei paket-grenze.vor-footprint-20261119. Ohne Remote ist das keine Sicherung gegen Verlust des Macs.
Auch noch uncommittet dort: .bin/paket-push-pruefen (geändert, nicht von mir) und mehrere unversionierte Werkzeuge (paket-pr, paket-push, paket-pruefer usw.).
