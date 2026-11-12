# Alarm db-pool-wartend

Regel: `docs/betrieb/grafana/alarmregeln.json`, Eintrag `db-pool-wartend` (Schwelle und Dauer stehen nur dort). Messgröße: `hermes.db.pool.waiting`.

## Symptom

Datenbank-Anfragen warten auf eine freie Verbindung; Antworten stauen sich.

## Prüfen

1. Prüfen, ob `http-dauer-p95` mitfeuert.
2. Im Postgres-Dashboard offene Verbindungen und lange laufende Abfragen ansehen.
3. In den Render-Logs auf Datenbankfehler achten.

## Beheben

- Lange hängende Abfragen beenden.
- Hängt die Datenbank, sie im Render-Dashboard neu starten; Pool-Größe ist in `src/config.js` und `.env.example` beschrieben.
- Bei Datenverlust-Verdacht nicht selbst reparieren, sondern eskalieren.

## Eskalieren

Hilft das Beheben nicht, die Bereitschaft über den Kontaktpunkt `bereitschaft` ansprechen. Bei Gefahr für Kosten oder echte Anrufe zuerst den Kill-Switch `OUTBOUND_FROZEN` setzen (`docs/RUNBOOK-OUTBOUND.md`).
Bei Datenverlust `docs/RUNBOOK-RESTORE.md` befolgen.
