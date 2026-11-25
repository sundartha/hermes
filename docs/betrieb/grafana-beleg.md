# Beleg Grafana: Einspielung, Metrikweg, Alarm

Stand: Gerüst. Die Felder unten sind ausstehend, bis die Einspielung mit echten Zugängen gelaufen ist (Issue #6178). Werte und Schlüssel stehen nie hier; sie liegen im Environment `produktion` (GitHub) und im Render-Dashboard.

## Entscheidung zum Pfad

Die Dateien bleiben unter `docs/betrieb/grafana/`. Grund: `.github/workflows/live.yml` (Job `grafana-einspielen`), die Tests unter `test/betrieb/` und die Anleitungen unter `docs/betrieb/alarme/` verweisen darauf; ein Umzug nach `tools/betrieb/grafana/` brächte keinen Belegwert.

## Voraussetzungen

- GitHub-Environment `produktion`: Variable `GRAFANA_URL`, Secret `GRAFANA_TOKEN` (Quelle: `live.yml`, Job `grafana-einspielen`).
- Render-Dashboard: `METRIKEN_OTLP_URL`, `METRIKEN_OTLP_BENUTZER`, `METRIKEN_OTLP_TOKEN` (Schlüssel in `render.yaml`, Bedeutung in `.env.example` und `src/config.ts`).
- Antonio trägt die Werte einmalig mit verdeckter Abfrage ein.

## Einspielung

- Datum: ausstehend
- Lauf-Link (`live.yml`, `aufgabe` = `grafana`): ausstehend
- Dashboard-URL: ausstehend

## Metrik sichtbar

- Metrik: `http-dauer`
- Abfrage oder Screenshot: ausstehend

## Alarm und Zustellung

- Regel und Anleitung: ausstehend (Probe siehe `docs/betrieb/alarme/README.md`)
- Zustellung (Slack oder Better Stack): ausstehend

## Folgearbeit

Die Live-Probe #4097 baut auf diesem Beleg auf und läuft erst danach.
