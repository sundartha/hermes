# Notruf N4: Datenbank weg

Prüfliste: Kennung N4 in `docs/betrieb/launch-pruefliste.md`. Die Schritte der Wiederherstellung stehen in `docs/RUNBOOK-RESTORE.md`; diese Seite führt dorthin und sagt, was vorher zu tun ist.

## Symptom

`/healthz` antwortet 503, der Alarm `db-pool-wartend` (`docs/betrieb/alarme/db-pool-wartend.md`) löst aus, Anrufe oder Anmeldungen scheitern mit Speicherfehlern, die Datenbank im Render-Dashboard ist nicht erreichbar oder gelöscht.

## Prüfen

1. Im Render-Dashboard den Zustand der Datenbank ansehen (läuft, neu startet, gelöscht).
2. Kurzer Ausfall (Neustart): Hermes verbindet sich laut `docs/RUNBOOK-AUSFALLPROBEN.md` (Probe `postgres-neustart`) selbst wieder; einige Minuten beobachten.
3. Datenverlust oder Beschädigung: nicht schreiben, nichts überschreiben (`docs/RUNBOOK-RESTORE.md`, Abschnitt „ZUERST LESEN“).

## Beheben

1. Bei Anrufrisiko oder unklarem Zustand `docs/betrieb/notruf-n1.md` (Kill-Switch).
2. Wiederherstellung nach `docs/RUNBOOK-RESTORE.md`: Entscheidung des Pfads, neue Instanz, Verifikation vor der Umschaltung.
3. Erst nach der Verifikation `OUTBOUND_FROZEN` lösen und einen Testanruf an die eigene Nummer auslösen.

## Eskalieren

Dauert der Ausfall länger als der Zielwert in `docs/RUNBOOK-RESTORE.md` (Abschnitt RTO/RPO) oder ist Datenverlust möglich, sofort Antonio über den Kontaktpunkt `bereitschaft` ansprechen und beim Hosting-Anbieter ein Ticket öffnen.
