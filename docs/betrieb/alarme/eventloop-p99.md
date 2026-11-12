# Alarm eventloop-p99

Regel: `docs/betrieb/grafana/alarmregeln.json`, Eintrag `eventloop-p99` (Schwelle und Dauer stehen nur dort). Messgröße: `hermes.eventloop.delay.p99`.

## Symptom

Der Node-Prozess reagiert verzögert; Anrufe und Webhooks kommen spät an.

## Prüfen

1. Prüfen, ob `http-dauer-p95` mitfeuert.
2. In den Render-Logs nach langen synchronen Aufgaben oder Speicherdruck suchen.
3. Im Render-Dashboard CPU- und Speicherauslastung des Dienstes ansehen.

## Beheben

- Auslöser (neuer Release, Lastspitze) ermitteln und zurückrollen oder drosseln.
- Bei Speicher- oder CPU-Sättigung den Dienst im Render-Dashboard neu starten oder die Instanzgröße erhöhen.

## Eskalieren

Hilft das Beheben nicht, die Bereitschaft über den Kontaktpunkt `bereitschaft` ansprechen. Bei Gefahr für Kosten oder echte Anrufe zuerst den Kill-Switch `OUTBOUND_FROZEN` setzen (`docs/RUNBOOK-OUTBOUND.md`).
