# Bereitschaft mit Telefonalarm

Prüfliste: Kennung B1 in `docs/betrieb/launch-pruefliste.md`, Schwelle als `PFLICHT` in `scripts/launch-pruefliste.mjs`. Wert ist die Zahl der Personen in Bereitschaft, deren Telefon beim Probealarm geklingelt hat und die den Alarm quittiert haben.

Alle Alarmregeln unter `docs/betrieb/grafana/` melden an den Kontaktpunkt `bereitschaft` (Feld `notification_settings.receiver`). Namen und Telefonnummern stehen nur im Alarmdienst, nie im Repo.

## Einrichten

Diese Handgriffe bei Dritten macht Antonio; sie gelten erst als erledigt, wenn die Probe bestanden ist.

1. Beim Alarmdienst (Better Stack) einen Bereitschaftsplan mit Person, Telefonalarm und nächster Stufe für den Fall ohne Quittung anlegen.
2. In Grafana den Kontaktpunkt `bereitschaft` anlegen und auf diesen Plan leiten.
3. Beim Alarmdienst einen externen Check auf `/healthz` der Produktion anlegen (Adresse: `PRODUKTION_URL` in `.github/workflows/live.yml`), damit auch ein Ausfall ohne Messwerte alarmiert.
4. Die Regeln einspielen: Job `grafana-einspielen` in `.github/workflows/live.yml`, Ablauf in `docs/betrieb/alarme/README.md`. Welche Regeldateien der Job einspielt, steht in seinen Schritten; eine dort fehlende Datei alarmiert nicht.

## Probe

1. Den Abschnitt „Probe“ in `docs/betrieb/alarme/README.md` durchführen.
2. Prüfen, dass das Telefon der Bereitschaft klingelt, auch bei stummgeschaltetem Gerät, und der Alarm quittiert werden kann.
3. Einen Alarm unquittiert lassen und prüfen, dass die nächste Stufe angerufen wird.
4. Antonio trägt Wert, Datum und Beleg (Vorfall im Alarmdienst) selbst in die Prüfliste ein.

## Symptom

Das Telefon klingelt mit einem Alarm, oder ein Alarm hätte kommen müssen und kam nicht.

## Prüfen

1. Alarm quittieren und die Seite aus `runbook_url` der Regel öffnen (Ordner `docs/betrieb/alarme/`).
2. Notfall einordnen: Anrufe oder Kosten außer Kontrolle `docs/betrieb/notruf-n1.md`, Anbieterausfall `docs/betrieb/notruf-n2.md`, Kostendecke `docs/betrieb/notruf-n3.md`, Datenbank weg `docs/betrieb/notruf-n4.md`, Auslastung `docs/betrieb/kontingente.md`.

## Beheben

1. Der gewählten Seite folgen.
2. Anrufe pausieren, freigeben oder den Dienst zurückrollen geht über den Workflow `.github/workflows/notfall.yml`; wer ihn starten darf, steht in seinen Bedingungen.
3. Kam kein Alarm: Kontaktpunkt, Bereitschaftsplan und eingespielte Regeln prüfen, danach die Probe wiederholen.

## Eskalieren

Lässt sich die Lage nicht beheben oder ist sie unklar, die nächste Stufe des Bereitschaftsplans anrufen. Bei Gefahr für Kosten oder echte Anrufe vorher den Kill-Switch setzen (`docs/betrieb/notruf-n1.md`).
