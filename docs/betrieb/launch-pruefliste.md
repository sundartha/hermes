# Launch-Prüfliste

Belegt vor dem Launch, dass Hermes startklar ist. Prüfen mit `node scripts/launch-pruefliste.mjs` (oder `npm run launch-pruefliste`). Das Skript liest nur diese Datei und die Anleitungen im Repo, es braucht kein Netz, keine Anrufe und keine Schlüssel. Es ist nicht Teil der CI.

Solange Wert, Datum oder Beleg leer sind oder eine Anleitung fehlt, ist die Liste rot. Das ist gewollt: Bis zur Abnahme ist Hermes nicht startklar.

Die Pflicht-Kennungen und ihre Schwellen stehen als `PFLICHT` in `scripts/launch-pruefliste.mjs`; die Schwelle in der Tabelle muss damit übereinstimmen. Wert in der Einheit der Schwelle, Datum als `JJJJ-MM-TT`, Beleg als Verweis (Lauf, Issue, Protokoll).

Quellen der Schwellen: Q1 bis Q3 #2935, Q4 #2637 und #2935, Q5 #2934 und #3377, Q6 bis Q10 #2931, Q11 #2512. K1 bis K3 bei Telnyx, ElevenLabs und Anthropic: gleichzeitig tragbare Anrufe passend zum Auslegungsziel von 20.

| Kennung | Punkt | Schwelle | Wert | Belegt am | Beleg | Anleitung |
| --- | --- | --- | --- | --- | --- | --- |
| Q1 | Fehlerquote im Lastlauf in Prozent | ≤ 0,5 | | | | — |
| Q2 | Verlorene Anrufe im Lastlauf | ≤ 0 | | | | — |
| Q3 | Längste Wartezeit eines Anrufs in Sekunden | ≤ 120 | | | | — |
| Q4 | Routen im Gespräch über Budget | ≤ 0 | | | | — |
| Q5 | Gleichzeitige Anrufe gehalten | ≥ 20 | | | | — |
| Q6 | ElevenLabs aus, /healthz in Millisekunden | ≤ 2000 | | | | — |
| Q7 | ElevenLabs fünffach langsam, /healthz in Millisekunden | ≤ 2000 | | | | — |
| Q8 | Postgres-Neustart, wieder 200 nach Sekunden | ≤ 30 | | | | — |
| Q9 | Instanz-Tod, Probe grün | ≥ 1 | | | | — |
| Q10 | Deploy bei Anruf, beendet nach Millisekunden | ≤ 8000 | | | | — |
| Q11 | /healthz antwortet 503 bei kaputter Instanz, Probe grün | ≥ 1 | | | | — |
| N1 | Notruf: Kill-Switch OUTBOUND_FROZEN setzen und lösen | — | | | | docs/betrieb/notruf-n1.md |
| N2 | Notruf: Ausfall eines Anbieters | — | | | | docs/betrieb/notruf-n2.md |
| N3 | Notruf: Kostendecke eines Mandanten oder Kostenalarm | — | | | | docs/betrieb/notruf-n3.md |
| N4 | Notruf: Datenbank weg | — | | | | docs/betrieb/notruf-n4.md |
| R1 | Wiederherstellung aus Render geprobt | — | | | | docs/RUNBOOK-RESTORE.md |
| K1 | Kontingent Telnyx, gleichzeitige Anrufe | ≥ 20 | | | | docs/betrieb/kontingente.md |
| K2 | Kontingent ElevenLabs, gleichzeitige Anrufe | ≥ 20 | | | | docs/betrieb/kontingente.md |
| K3 | Kontingent Anthropic, gleichzeitige Anrufe | ≥ 20 | | | | docs/betrieb/kontingente.md |
| B1 | Bereitschaft mit Telefonalarm aktiv | ≥ 1 | | | | docs/betrieb/bereitschaft.md |
| G1 | Geheimnis-Tausch einmal geprobt | — | | | | docs/betrieb/geheimnis-tausch.md |
