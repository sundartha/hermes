# Alarm anruf-annahmezeit

Regel: `docs/betrieb/grafana/anrufregeln.json`, Eintrag `anruf-annahmezeit` (Ziel, Fenster, Faktoren und Mindestmenge stehen nur dort, im Feld `burnrate`). Messgröße: `hermes.call.answer_time` (Histogramm, Grenze `le="5"`).

Das Ziel und die Schwellen sind ein Vorschlag, durch Messung zu bestätigen. Das Ziel steht in `anrufregeln.json` unter `burnrate.slo` und gilt für die Annahmezeit; es zählen nur eingehende Anrufe (`direction="inbound"`).

## Symptom

Zu viele Anrufe brauchen länger als 5 Sekunden bis zur Annahme. Gemessen wird die Annahmezeit, nicht die Zeit bis zur Begrüßung; für diese gibt es noch keine Kennzahl.

## Prüfen

1. Im Panel der Annahmezeit nach Richtung aufschlüsseln.
2. Warteschlange und Leitungsbelegung ansehen (`hermes.queue.oldest_age`, `hermes.lines.occupied`).
3. Event-Loop und Datenbank-Pool prüfen (Alarme `eventloop-p99`, `db-pool-wartend`).

## Beheben

- Bei belegten Leitungen die Last senken.
- Bei langsamem Anbieter abwarten und Anbieter-Status beobachten.
- Bei Event-Loop- oder Pool-Alarm zuerst dessen Seite abarbeiten.

## Eskalieren

Hilft das Beheben nicht, die Bereitschaft über den Kontaktpunkt `bereitschaft` ansprechen. Bei Gefahr für Kosten oder echte Anrufe zuerst den Kill-Switch `OUTBOUND_FROZEN` setzen (`docs/RUNBOOK-OUTBOUND.md`).
