# Alarm heartbeat-fehlt

Regel: `docs/betrieb/grafana/betriebsregeln.json`, Eintrag `heartbeat-fehlt` (Schwelle und Dauer stehen nur dort; sie sind ein Vorschlag, der durch Messung zu bestätigen ist). Messgröße: `hermes.eventloop.delay.p99` in Millisekunden; gezählt wird nur, ob überhaupt Werte ankommen.

## Symptom

Von Hermes kommen keine Messwerte mehr an: Der Dienst steht, hängt oder sein Messexport ist unterbrochen. Solange das so ist, schweigen auch die übrigen Regeln.

## Prüfen

1. `/healthz` der Produktion aufrufen (Adresse: `PRODUKTION_URL` in `.github/workflows/live.yml`).
2. Im Render-Dashboard Zustand, letzte Deploys und Logs des Dienstes ansehen.
3. Antwortet der Dienst, in den Logs nach Exportfehlern suchen und prüfen, ob die `METRIKEN_OTLP_`-Werte gesetzt sind (Namen in `render.yaml` und `.env.example`).
4. In Grafana prüfen, ob die Datenquelle selbst antwortet.

## Beheben

- Dienst steht oder hängt: im Render-Dashboard neu starten; nach einem Deploy zurückrollen (Workflow `.github/workflows/notfall.yml`).
- Nur der Export fehlt: Zugangsdaten im Render-Dashboard neu setzen (`docs/betrieb/geheimnis-tausch.md`).

## Eskalieren

Hilft das Beheben nicht, die Bereitschaft über den Kontaktpunkt `bereitschaft` ansprechen. Ist unklar, ob Anrufe unbeobachtet laufen, zuerst den Kill-Switch `OUTBOUND_FROZEN` setzen (`docs/betrieb/notruf-n1.md`).
