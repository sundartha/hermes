# Alarm anbieter-fehlerquote

Regel: `docs/betrieb/grafana/alarmregeln.json`, Eintrag `anbieter-fehlerquote` (Schwelle und Dauer stehen nur dort). Messgröße: `hermes.anbieter.aufrufe`.

## Symptom

Aufrufe an Telnyx, ElevenLabs oder andere Anbieter scheitern oder laufen in Zeitüberschreitung (Attribut `ergebnis` ungleich `ok`).

## Prüfen

1. Im Panel nach Attribut `anbieter` und `vorgang` aufschlüsseln, um den Anbieter zu finden.
2. Statusseite des betroffenen Anbieters ansehen.
3. Prüfen, ob `ergebnis` `429` (Drosselung) oder `zeitueberschreitung` ist.

## Beheben

- Liegt es am Anbieter: abwarten und Anbieter-Status beobachten.
- Bei Drosselung die Last senken.
- Bei abgelaufenem oder falschem Schlüssel den Wert im Render-Dashboard neu setzen (Namen in `.env.example`).

## Eskalieren

Hilft das Beheben nicht, die Bereitschaft über den Kontaktpunkt `bereitschaft` ansprechen. Bei Gefahr für Kosten oder echte Anrufe zuerst den Kill-Switch `OUTBOUND_FROZEN` setzen (`docs/RUNBOOK-OUTBOUND.md`).
