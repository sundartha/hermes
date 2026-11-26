# Alarm warteschlange-alter

Regel: `docs/betrieb/grafana/betriebsregeln.json`, Eintrag `warteschlange-alter` (Schwelle und Dauer stehen nur dort; sie sind ein Vorschlag, der durch Messung zu bestätigen ist). Messgröße: `hermes.queue.oldest_age` in Sekunden, je Attribut `art`; dazu `hermes.queue.length`.

## Symptom

Ein Auftrag der Warteschlange wartet auf seine Bearbeitung und wird immer älter; was daran hängt, passiert für den Kunden verspätet oder gar nicht.

## Prüfen

1. Am Attribut `art` ablesen, welche Warteschlange betroffen ist, und im Panel ihre Länge ansehen.
2. Das Alter zählt ab Anlage des Auftrags, Wiederholungen nach einem Fehler eingeschlossen (Quelle: `wartendeJeArt` in `src/queue/adapters/pgboss/queue.ts`). In den Render-Logs nach wiederholten Fehlern dieser Art suchen.
3. Prüfen, ob `db-pool-wartend`, `datenbank-speichern-fehlt` oder `anbieter-fehlerquote` mitfeuert.

## Beheben

- Scheitert die Verarbeitung an einem Anbieter, `docs/betrieb/notruf-n2.md` folgen.
- Hängt die Verarbeitung, den Dienst im Render-Dashboard neu starten.
- Aufträge nicht von Hand in der Datenbank löschen oder umschreiben.

## Eskalieren

Hilft das Beheben nicht, die Bereitschaft über den Kontaktpunkt `bereitschaft` ansprechen. Bei Gefahr für Kosten oder echte Anrufe zuerst den Kill-Switch `OUTBOUND_FROZEN` setzen (`docs/RUNBOOK-OUTBOUND.md`).
