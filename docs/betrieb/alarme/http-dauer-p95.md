# Alarm http-dauer-p95

Regel: `docs/betrieb/grafana/alarmregeln.json`, Eintrag `http-dauer-p95` (Schwelle und Dauer stehen nur dort). Messgröße: `hermes.http.server.duration`.

## Symptom

Antworten von Hermes werden langsam; Aufrufer und Dashboard merken Verzögerung.

## Prüfen

1. Im Grafana-Panel die langsamen Routen nach Route aufschlüsseln.
2. Prüfen, ob gleichzeitig `eventloop-p99`, `db-pool-wartend` oder `anbieter-fehlerquote` feuern; dann ist deren Seite die Ursache.
3. Render-Logs des Dienstes auf Fehler und Neustarts ansehen.

## Beheben

- Ist ein Anbieter langsam: die Seite `anbieter-fehlerquote` befolgen.
- Ist der Pool voll: die Seite `db-pool-wartend` befolgen.
- Nach einem fehlerhaften Release im Render-Dashboard auf das vorige Deploy zurückrollen.

## Eskalieren

Hilft das Beheben nicht, die Bereitschaft über den Kontaktpunkt `bereitschaft` ansprechen. Bei Gefahr für Kosten oder echte Anrufe zuerst den Kill-Switch `OUTBOUND_FROZEN` setzen (`docs/RUNBOOK-OUTBOUND.md`).
