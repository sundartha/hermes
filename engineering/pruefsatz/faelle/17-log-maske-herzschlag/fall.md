# 17 Log-Maske, Herzschlag-Adresse
Fehler: Die Herzschlag-Adresse (HERZSCHLAG_URL, enthält ein Geheimnis im Pfad) wird nicht mehr aus Logs maskiert, weil der Sonderfall in istGeheimnis fehlt (Name endet nicht auf KEY/TOKEN…).
Herkunft: PR #3164 (Paket B7), Commit 129e8e5, Issue #2760.
Fand ihn damals: unbekannt (Prüf-Agent-Review an PR #3164 ohne belegten Fund).
Erwartet rot: test/sicherheit/log-maske.test.js.
