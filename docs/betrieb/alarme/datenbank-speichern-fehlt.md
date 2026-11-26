# Alarm datenbank-speichern-fehlt

Regel: `docs/betrieb/grafana/betriebsregeln.json`, Eintrag `datenbank-speichern-fehlt` (Schwelle und Dauer stehen nur dort; sie sind ein Vorschlag, der durch Messung zu bestätigen ist). Messgröße: `hermes.store.save.failed` (Anzahl gescheiterter Speichervorgänge).

## Symptom

Hermes kann seinen Zustand nicht in die Datenbank schreiben; Änderungen an Anrufen und Konten drohen verloren zu gehen. Die Regel braucht wiederholte Fehlschläge: Der erste nach einem Neustart löst allein nicht sicher aus. Ohne Speichervorgänge bleibt sie still, auch wenn die Datenbank weg ist.

## Prüfen

1. In den Render-Logs die Zeilen `[pg] Flush fehlgeschlagen` lesen.
2. Im Render-Dashboard den Zustand der Datenbank ansehen.
3. Prüfen, ob `db-pool-wartend` mitfeuert.

## Beheben

Der Anleitung `docs/betrieb/notruf-n4.md` folgen.

## Eskalieren

Hilft das Beheben nicht, die Bereitschaft über den Kontaktpunkt `bereitschaft` ansprechen. Bei Gefahr für Kosten oder echte Anrufe zuerst den Kill-Switch `OUTBOUND_FROZEN` setzen (`docs/RUNBOOK-OUTBOUND.md`).
Bei Datenverlust `docs/RUNBOOK-RESTORE.md` befolgen.
