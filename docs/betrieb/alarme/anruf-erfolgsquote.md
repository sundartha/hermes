# Alarm anruf-erfolgsquote

Regel: `docs/betrieb/grafana/anrufregeln.json`, Eintrag `anruf-erfolgsquote` (Ziel, Fenster, Faktoren und Mindestmenge stehen nur dort, im Feld `burnrate`). Messgröße: `hermes.call.ended` mit Attribut `ergebnis`.

Das Ziel und die Schwellen sind ein Vorschlag, durch Messung zu bestätigen. Das Ziel gilt für den Anteil erfolgreich beendeter Anrufe; Nichtannahme und Besetzt (`no-answer`, `busy`, `keiner`) zählen nicht als Fehler (Quelle: `burnrate.fehler` in `anrufregeln.json`).

## Symptom

Zu viele beendete Anrufe haben das Ergebnis `failed`. Der Alarm kommt, wenn die Fehlerquote in beiden Fenstern eines Paares über Faktor mal Fehlerbudget liegt und genug Anrufe gestartet wurden.

## Prüfen

1. Im Panel der beendeten Anrufe nach `grund` aufschlüsseln, um die häufigste Ursache zu finden.
2. Prüfen, ob ein Anbieter betroffen ist (Alarm `anbieter-fehlerquote`, Statusseite von Telnyx und ElevenLabs).
3. Einzelne fehlgeschlagene Anrufe im Dashboard öffnen und den Grund lesen.

## Beheben

- Liegt es am Anbieter: abwarten und Anbieter-Status beobachten.
- Bei `at-capacity` die Leitungen und Kapazität prüfen.
- Bei `not-placed` zuerst die Ursache im Anruf-Ergebnis lesen, nicht erneut wählen.

## Eskalieren

Hilft das Beheben nicht, die Bereitschaft über den Kontaktpunkt `bereitschaft` ansprechen. Bei Gefahr für Kosten oder echte Anrufe zuerst den Kill-Switch `OUTBOUND_FROZEN` setzen (`docs/RUNBOOK-OUTBOUND.md`).
