# Fragerunden E-2760 Lebenszeichen

## Entscheidungen der Sitzung

| Nr. | Punkt | Entscheidung | Grund |
|---|---|---|---|
| E1 | Art der Änderung | einfache Änderung (Paket B7, Teil von #2760), Phasendatei bleibt `E-2760-lebenszeichen` | Die Phase ist seit dem 03.11.2026 als E-Phase mit drei Aufträgen gebaut; a1 und a2 sind gemergt-fertig im Branch, a3 ist der letzte offene Auftrag. |
| E2 | uncommittete Änderung (H8) an `phase.json` | zum Plan gehörig, committet | Sie hält den Befund aus Lauf 17 im Entwurf von a3 fest und lässt die Erwartung an den Dienst unverändert. |
| E3 | Entscheidungsnotiz zu a3 in #2760: Reihenfolge der Aufräumhooks im Abnahmetest | Option 1: Entwurf von a3 um (H9) ergänzt, `lauf` neu gestartet, Phasendatei sonst unverändert | Der Bau-Agent meldete 7 von 8 Fällen grün und scheiterte allein am `t.after(erlaubeVerbindungen)`, das nach dem Löschen der Test-Datenbank läuft; die Erwartung bleibt, kein Wiederöffnen gestrichen, keine Änderung der gemeinsamen Testhilfe. |

## Offen bei Antonio

keiner
