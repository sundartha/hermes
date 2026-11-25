# Notruf N2: Ausfall eines Anbieters

Prüfliste: Kennung N2 in `docs/betrieb/launch-pruefliste.md`. Gemeint sind Telnyx, ElevenLabs und Anthropic. Wie Hermes sich bei Ausfall verhält, belegen die Proben in `docs/RUNBOOK-AUSFALLPROBEN.md`.

## Symptom

Der Alarm `anbieter-fehlerquote` (`docs/betrieb/alarme/anbieter-fehlerquote.md`) löst aus, Anrufe scheitern oder brechen ab, `/healthz` meldet Probleme.

## Prüfen

1. Alarmseite `anbieter-fehlerquote` abarbeiten: nach `anbieter` und `vorgang` aufschlüsseln, `ergebnis` ansehen.
2. Statusseite des betroffenen Anbieters ansehen.
3. Prüfen, ob nur ein Schlüssel abgelaufen oder falsch ist (Namen in `.env.example`, nie den Wert in Tickets oder Chat kopieren).

## Beheben

- Anbieter gestört: abwarten, Anbieter-Status beobachten. Bei Kosten- oder Anrufrisiko zuerst `docs/betrieb/notruf-n1.md` (Kill-Switch).
- Drosselung (`429`): Last senken, Kontingente prüfen (`docs/betrieb/kontingente.md`).
- Schlüssel falsch: im Render-Dashboard neu setzen, nach `docs/betrieb/geheimnis-tausch.md`.
- Nach der Entwarnung einen einzelnen Testanruf an die eigene Nummer auslösen.

## Eskalieren

Hält die Störung an oder betrifft sie mehrere Anbieter, die Bereitschaft über den Kontaktpunkt `bereitschaft` ansprechen und Kunden nach Absprache informieren.
