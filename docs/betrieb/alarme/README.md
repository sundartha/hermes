# Alarmregeln: Anleitungen und Probe

Jede Regel in `docs/betrieb/grafana/alarmregeln.json` verweist über `runbook_url` auf eine Seite in diesem Ordner. Das Dashboard liegt in `docs/betrieb/grafana/dashboard.json`; `npm run betrieb-pruefen` hält beides mit den gelieferten Kennzahlen in Einklang.

## Probe

Ein Mensch führt die Probe nach dem Merge des Einspiel-Jobs aus, sobald Grafana-Zugang und Kontaktpunkt `bereitschaft` vorhanden sind.

1. Den Einspiel-Job per `workflow_dispatch` mit dem aktuellen master starten.
2. Eine Regel mit Testdaten auslösen, zum Beispiel die Schwelle in Grafana vorübergehend unter den aktuellen Messwert setzen.
3. Prüfen, dass beim Kontaktpunkt `bereitschaft` ein Vorfall ankommt und die Meldung auf die Seite der Regel verweist.
4. Schwelle zurücksetzen und das Ergebnis im Issue #3369 festhalten.
