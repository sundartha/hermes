# Test webhook-zustellung-nachlauf-zweifach (18.11.2026 ca. 13:30)
1. Wache (belege/wache-nachlauf-zweifach.sh, Mac, PID 62482, gestartet 09:26, Ende 13:26): läuft nicht seit dem Serverumzug auf dem Server, sondern auf dem Mac. Sie wertet alle 10 min die Fehlschläge von ci.yml (nach 07:32 UTC) aus; .gesehen listet die geprüften Läufe, .rot wurde nie geschrieben -> in dem Zeitraum kein CI-Lauf mit Fehler dieses Tests.
2. Direkter Lauf auf dem Mac (master 6c822861, Node 22.23.2, NODE_ENV=test): exit 0, aber 12 von 12 Tests SKIP "kein Postgres" (pass 0, fail 0). Lokal ohne Datenbank nicht aussagekräftig; der echte Beleg ist nur der CI-Job mit Postgres.
3. Auffällig: Auf dem Mac läuft seit gestern 18:55 (18 h) ein hängender Prozess `node test/anrufe/webhook-zustellung-nachlauf-zweifach.test.js` (PID 87645). Beenden war mir von der Rechte-Sperre nicht erlaubt.
Ausgabe: /tmp/zweifach-lauf.txt (Mac)
