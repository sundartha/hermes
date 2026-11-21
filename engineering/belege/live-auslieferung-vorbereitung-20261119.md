# Live-Auslieferung: Vorbereitung (19.11.2026 14:30, Auftrag A-NWG3BT)

## Stand (gemessen 14:20, /healthz)
- Live (app.sundartha.com): Commit e3c612d3 (Workflow live zuletzt erfolgreich 18.11. 16:49Z)
- Staging: Commit 96fdfef5 = hermes/master
- Zwischen Live und master: 122 Commits, 199 Dateien, +8114/-908 Zeilen. Der Workflow live liefert immer den ganzen master-Commit aus, nie einzelne PRs.

## Zuordnung zum genannten Umfang
1. Anruf-Begrüßung kürzen, danach direkt Ergebnisse vortragen: nur ein naher Treffer: ff73bb28 „Anruf-Vorspann: Ziel mit eigenem Gruss ... Begruessung und KI-Hinweis genau einmal“. Ob das die gemeinte Kürzung ist, ist nicht belegt; ein Commit „direkt Ergebnisse vortragen“ habe ich nicht gefunden.
2. Widget-Endlos-Laden nach verpasstem Anruf: kein Commit gefunden (Suche nach widget, Endlos, verpasst; Dateien unter apps/web).
3. Nachgebesserte Widgets (4 Widgets, Ende-Zustand): kein Commit gefunden.
Möglich: diese Änderungen liegen in einem anderen Repo (App/Widget-Code) oder sind schon in e3c612d3 live. Das muss sundartha-produkt mit PR-Nummern belegen.

## Was sonst in den 122 Commits steckt (außerhalb des genannten Umfangs)
Überwiegend Mehrinstanz-Umbau (Anrufe/Profile/Posteingang per SQL, gezieltes Schreiben statt Gesamt-Flush, Webhooks lesen laufende Anrufe per SQL, Deploy-Zähler per SQL), Warteschlange für wartende Anrufe (b0d3a93b), place_call-Änderungen (66bb6228, 67f36e29), Statuscodes, Lint, Tests. Eine Datei mit „schema“ im Namen: src/mcp/schemata.js (keine SQL-/Migrationsdatei). Datenbank-Migrationen (zerstörend) habe ich in der Differenz nicht gefunden.
Folge: Ein Hand-Start von live auf 96fdfef5 liefert alles davon mit aus. Antonios Wortlaut („deploye auf live die ganzen Änderungen“) deckt das, die Eingrenzung auf drei Punkte nicht. Das muss geklärt werden, bevor er den Hand-Start macht.

## Rücknahme (vorher notiert)
1. GitHub -> Actions -> Workflow live -> „...“ -> Disable workflow.
2. Render -> vodafone-agent -> Deploys -> Deploy auf e3c612d3 -> Rollback to this deploy (Render Free: nur zu einem der zwei letzten Deploys).
3. /healthz von app.sundartha.com muss e3c612d3 melden.

## Zwei-Zeilen-Anleitung Hand-Start (nur Antonio20045 oder jonas986)
GitHub -> Actions -> Workflow live -> Run workflow, Branch master, Eingabe commit = 96fdfef5651355a707c91a65f20f4a3f208e41be (bei neuem Merge vorher aktuellen master-Commit nehmen; Staging muss ihn melden).
Danach /healthz prüfen (Commit) und das Hoertest-Issue schließen.
Achtung: Laut Runbook kappt ein Deploy laufende Anrufe, solange #3375 offen ist (geparkt bis 23.11.).

## Probe-Anruf ohne Antonio: noch nicht gebaut
Weg: Skript ruft über die Staging-Agentennummer (nie Antonios Nummer) an, nimmt am Ziel selbst an, prüft Begrüßung und Ergebnis-Vortrag aus dem Transkript und schreibt grün/rot mit Beleg. Hindernis: ElevenLabs-Schlüssel fehlt im Schlüsselbund; Kosten je Probe-Anruf kann ich ohne Preisquelle nicht nennen (Annahme: wenige Minuten Sprachzeit, im Cent- bis niedrigen Euro-Bereich, nicht belegt). Entscheidung nötig: Zielnummer (eigene Testnummer, die ein Skript annimmt) und Kostenfreigabe.
