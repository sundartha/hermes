# Alarmregeln: Anleitungen und Probe

Jede Regel in `docs/betrieb/grafana/alarmregeln.json` verweist über `runbook_url` auf eine Seite in diesem Ordner. Das Dashboard liegt in `docs/betrieb/grafana/dashboard.json`; `npm run betrieb-pruefen` hält beides mit den gelieferten Kennzahlen in Einklang.

## Probe

Ein Mensch führt die Probe nach dem Merge des Einspiel-Jobs aus, sobald Grafana-Zugang und Kontaktpunkt `bereitschaft` vorhanden sind.

1. Den Einspiel-Job per `workflow_dispatch` mit `aufgabe` = `grafana` und dem aktuellen master als `commit` starten; `aufgabe` = `deploy` wäre ein Live-Deploy.
2. Eine Regel mit Testdaten auslösen, zum Beispiel die Schwelle in Grafana vorübergehend unter den aktuellen Messwert setzen.
3. Prüfen, dass beim Kontaktpunkt `bereitschaft` ein Vorfall ankommt und die Meldung auf die Seite der Regel verweist.
4. Schwelle zurücksetzen und das Ergebnis im Issue #3369 festhalten.

## Betriebs-Regeln

`docs/betrieb/grafana/betriebsregeln.json` enthält die Regeln zu Heartbeat, Alter der Warteschlange, Leitungskapazität und gescheitertem Speichern. Jede Regel hat eine Seite in diesem Ordner; `npm run betrieb-pruefen` prüft Seiten, Kennzahlnamen im Ausdruck und Schwelle, Dauer und `noDataState` gegen das Feld `soll`. Die Schwellen sind ein Vorschlag, der durch Messung zu bestätigen ist. Der Job `grafana-einspielen` in `.github/workflows/live.yml` spielt nur die Regeldateien ein, die in seinen Schritten stehen; eine dort fehlende Datei alarmiert nicht.

## Anruf-Regeln

`docs/betrieb/grafana/anrufregeln.json` enthält die Regeln zur Anrufqualität mit Burn-Rate-Fenstern und wird beim Grafana-Import mit `alarmregeln.json` mitgenommen. Jede Regel hat eine Seite in diesem Ordner; `npm run betrieb-pruefen` prüft Seiten und Ausdruck gegen das Feld `burnrate`. Mit `node scripts/betrieb-pruefen.mjs --probe <json>` lässt sich mit erfundenen Werten ausprobieren, welches Fensterpaar auslöst.
