# Alarm anruf-abbruchrate

Regel: `docs/betrieb/grafana/anrufregeln.json`, Eintrag `anruf-abbruchrate` (Ziel, Fenster, Faktoren und Mindestmenge stehen nur dort, im Feld `burnrate`). Messgröße: `hermes.call.ended` mit Attribut `grund` (`canceled`, `result-unknown`).

Das Ziel und die Schwellen sind ein Vorschlag, durch Messung zu bestätigen. Das Ziel gilt für den Anteil nicht abgebrochener Anrufe.

## Symptom

Zu viele Anrufe enden mit Abbruch oder unbekanntem Ergebnis. Der Alarm kommt, wenn die Quote in beiden Fenstern eines Paares über Faktor mal Fehlerbudget liegt und genug Anrufe gestartet wurden.

## Prüfen

1. Im Panel der beendeten Anrufe `grund` `canceled` und `result-unknown` getrennt ansehen.
2. Prüfen, ob die Anbieter-Rückmeldung fehlt (Alarm `anbieter-fehlerquote`).
3. Einzelne betroffene Anrufe im Dashboard öffnen.

## Beheben

- Bei `result-unknown` den Anbieter-Status prüfen und abwarten.
- Bei vielen `canceled` prüfen, ob Auftraggeber Anrufe zurückziehen oder die Leitung vorzeitig auflegt.

## Eskalieren

Hilft das Beheben nicht, die Bereitschaft über den Kontaktpunkt `bereitschaft` ansprechen. Bei Gefahr für Kosten oder echte Anrufe zuerst den Kill-Switch `OUTBOUND_FROZEN` setzen (`docs/RUNBOOK-OUTBOUND.md`).
