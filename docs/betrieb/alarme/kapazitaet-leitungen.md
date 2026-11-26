# Alarm kapazitaet-leitungen

Regel: `docs/betrieb/grafana/betriebsregeln.json`, Eintrag `kapazitaet-leitungen` (Schwelle und Dauer stehen nur dort; sie sind ein Vorschlag, der durch Messung zu bestätigen ist). Messgröße: Anteil `hermes.lines.occupied` an `hermes.lines.capacity` (Verhältnis ohne Einheit), je Attribut `anbieter`.

## Symptom

Die Leitungsplätze eines Anbieters werden knapp; weitere Anrufe warten oder werden abgewiesen. Ausgehende Anrufe stoßen früher an die Grenze, weil ein Teil der Plätze für eingehende frei bleibt (`KAPAZITAET` und `RESERVE` in `src/store/leitungsplaetze.js`).

## Prüfen

1. Am Attribut `anbieter` ablesen, wo es eng wird, und im Panel Belegung und Kapazität ansehen.
2. Prüfen, ob die Last von echten Anrufen kommt: `hermes.call.started` und `hermes.call.denied`.
3. Sinkt die Belegung nach Ende der Anrufe nicht, in den Render-Logs nach Anrufen ohne Abschluss suchen.

## Beheben

Der Anleitung `docs/betrieb/kontingente.md` folgen. Sicherheits- und Kosten-Gates werden dafür nicht gelockert.

## Eskalieren

Werden Anrufe abgewiesen und lässt sich die Last nicht senken, die Bereitschaft über den Kontaktpunkt `bereitschaft` ansprechen. Bei unerklärlich vielen Anrufen zuerst den Kill-Switch `OUTBOUND_FROZEN` setzen (`docs/betrieb/notruf-n1.md`).
