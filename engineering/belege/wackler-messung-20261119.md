# Wackler-Messung 10.11.–19.11.2026 (Auftrag A-U34G8D)

Gemessen 19.11.2026 14:50 (Europe/Berlin) aus GitHub Actions, Repo sundartha/hermes, nur lesend. Zeitraum: CI-Läufe vom 10.11. 00:00 bis 19.11. ~14:00 (UTC-Tagesgrenzen).

## Kurzfassung

- 5.468 CI-Läufe, davon 1.338 rot (PR 737, Merge-Queue 581, master 20). Bezogen auf 1.889 rote Versuche in PR und Queue (inkl. früherer Versuche von Läufen mit Wiederholung) sind **634 Wackler-Läufe = 34 %**: 171 belegt (Lauf am selben Stand beim Wiederholen grün), 463 wahrscheinlich (Queue-Lauf rot, späterer Queue-Lauf desselben PR grün, in der Zwischenzeit kein neuer Push). In der Merge-Queue sind es 463 von 581 roten Läufen (80 %).
- 81 Testdateien betroffen, 704 Test-Fälle. Die zehn häufigsten Dateien machen 467 Fälle (66 %) aus.
- **Herkunft:** 46 von 81 Dateien (57 %) und 522 von 704 Fällen (74 %) stammen aus Tests, die ab dem 10.11. geschrieben wurden; 35 Dateien (182 Fälle) davor. Aufgeteilt nach der Lage der Sperren: Einführung 10.–15.11. (nur Beschluss im Issue, noch keine Lint-Sperre): 41 Dateien, 493 Fälle. Einführung **ab 16.11.** (Sperre `kein-echt-warten` seit 15.11. 18:48 und `uhr-als-wert` seit 16.11. 12:13 aktiv): 5 Dateien, 29 Fälle (4 %), davon 20 Fälle aus einem Datenbank-Fall, nicht aus Zeit. Die Zeit-Klasse ist mit den Sperren also praktisch versiegt; was bleibt, sind Datenbank/Prozess/Reihenfolge und der Altbestand.
- Master: 20 rote Push-Läufe, alle nur im Job Lastlauf (nicht in Tests; Budget-/Fehlerquotenmessung unter Last, 13.11.–17.11., fast alle 17.11.). Kein Testjob auf master war rot.
- Vorschlag Absicherung (Teil 3b): die bestehende Regel `uhr-als-wert` lückenlos machen (Geltungsbereich und Bestandsliste), siehe unten. Kein neuer Workflow, keine neue Station.

## Methode (Belegbarkeit)

1. Alle Läufe des Workflows CI vom 10.–19.11. per API (5.468), je roter Lauf und je früherem Versuch die Jobs samt fehlgeschlagenem Schritt (1.929 Versuche).
2. Fehlgeschlagene Testjobs (1.000) wurden im Log gelesen: Zeile „✗ <Testname> (Datei:Zeile)“ und erste Fehlerzeile.
3. Wackler-Klassen: **A** = Versuch k rot, derselbe Lauf (derselbe Stand) beim Wiederholen grün (belegt). **B** = Merge-Queue-Lauf rot, späterer Queue-Lauf desselben PR grün, zwischen beiden kein Push auf den PR-Zweig (wahrscheinlich; kann auch ein Fehler einer vorgereihten PR oder eine geänderte Basis sein, deshalb zusätzlich die Zahl verschiedener PR je Test). **C** = master rot. Nicht gezählt: Läufe, die nach Wiederholung rot blieben (A2, 142 Läufe), und Queue-Läufe mit neuem Push (24).
4. Herkunft je Test: `git log --follow --diff-filter=A` für die Datei und `git log --follow -S<Testname>` für den Test (Autorendatum). Umbenennungen werden verfolgt; Testnamen, die später umbenannt wurden, können das Datum der Datei statt des Tests liefern.
5. Grenzen: Die Zeitklasse je Datei beruht auf Issues, Fehlermeldung und Quelltext; die Kennzeichen „Wanduhr/Warte-Hilfe“ unten messen den Stand von master heute (nach Reparaturen).

## Teil 1: Rangliste (Fälle = rote Läufe, in denen der Test fiel; A belegt, B wahrscheinlich)

| # | Testdatei | Fälle | A | B | PR | erster / letzter Fall | Meldung (erste Zeile) | Klasse |
|---|---|---|---|---|---|---|---|---|
| 1 | test/anrufe/webhook-zustellung-nachlauf-zweifach.test.js | 84 | 16 | 68 | 61 | 2026-11-13 / 2026-11-19 | `bisBedingung: Zeitgrenze von 20000ms erreicht; mitgeschnittene Anweisungen: [["SELECT * FROM call W | Zeit + gemeinsamer Zustand |
| 2 | test/anrufe/leitungsplaetze-elevenlabs-freigabe.test.js | 83 | 15 | 68 | 42 | 2026-11-17 / 2026-11-17 | S22: das Ende durch die Budget-Wache bei einem ElevenLabs-Anruf gibt den Platz nicht frei | Zeit / Reihenfolge |
| 3 | test/einstellungen/gedaechtnis-zwei-instanzen-eingang.test.js | 74 | 10 | 64 | 35 | 2026-11-15 / 2026-11-15 | Logzeile nicht erschienen: [pg] einstellungen nachladen fehlgeschlagen | Zeit (echte Frist) |
| 4 | test/anrufe/ausfall-erholung-schliesst-vorfall.test.js | 45 | 15 | 30 | 40 | 2026-11-15 / 2026-11-16 | Expected values to be strictly equal: | Zeit (Takt) |
| 5 | test/gemeinsam/widget-anruffolge-attrappe.test.js | 39 | 10 | 29 | 33 | 2026-11-13 / 2026-11-15 | fehler_de: Ergebnistext (erwartet Niemand hat abgehoben., erhalten —) | Last / Zeit |
| 6 | test/ausfallproben/ausfallprobe-postgres-neustart-meldet-gruen-oder-rot.test.js | 38 | 17 | 21 | 34 | 2026-11-12 / 2026-11-15 | {"probe":"postgres-neustart","ergebnis":"rot","schwelle":30000,"gemessen":null,"grund":"/healthz kam | Prozess + Last |
| 7 | test/rueckfrage/zusammenfassung-bei-done.test.js | 30 | 15 | 15 | 29 | 2026-11-12 / 2026-11-14 | Expected values to be strictly equal: (erwartet Der Termin am Donnerstag um zehn Uhr ist vereinbart. | Reihenfolge / Zeit |
| 8 | test/anrufe/telefonie-waechter-verhalten.test.js | 29 | 9 | 20 | 20 | 2026-11-12 / 2026-11-12 | Expected values to be strictly deep-equal: | Zeit (Takt) |
| 9 | test/werkzeuge/mutation-zeilen-abdeckung.test.js | 25 | 12 | 13 | 25 | 2026-11-10 / 2026-11-12 | Expected values to be strictly deep-equal: | Prozess / Last |
| 10 | test/anrufe/anruf-eroeffnung-postgres.test.js | 20 | 5 | 15 | 15 | 2026-11-16 / 2026-11-16 | test failed | Datenbank (gemeinsamer Zustand) |
| 11 | test/anrufe/elevenlabs-ende-messung.test.js | 20 | 4 | 16 | 20 | 2026-11-17 / 2026-11-19 | Summe 10.089 (erwartet true, erhalten false) | Zeit (Wanduhr) |
| 12 | test/anrufe/schutz-bei-ausgehenden-anrufen.test.js | 19 | 3 | 16 | 11 | 2026-11-18 / 2026-11-18 | {"error":"kein_laufender_anruf"} (erwartet 200, erhalten 404) |  |
| 13 | test/gemeinsam/widget-anruffolge-fenstergrenze.test.js | 17 | 7 | 10 | 13 | 2026-11-10 / 2026-11-10 | Expected values to be strictly deep-equal: |  |
| 14 | test/iel-b8-weiche.test.js | 15 | 7 | 8 | 14 | 2026-11-12 / 2026-11-12 | Bedingung nicht innerhalb der Testfrist erreicht |  |
| 15 | test/anrufe/schutz-dauer-und-wache-postgres.test.js | 14 | 1 | 13 | 14 | 2026-11-17 / 2026-11-19 | ohne Gespraechs-ID laesst sich das Beenden keinem Anruf zuordnen (erwartet true, erhalten ~) |  |
| 16 | test/anmeldung/login-bremse-ausfall.test.js | 12 | 8 | 4 | 12 | 2026-11-12 / 2026-11-17 | genau 4 belegen Verbindungen (erwartet 4, erhalten 3) |  |
| 17 | test/ausfallproben/ausfallprobe-alle-meldet-gesamtergebnis.test.js | 11 | 4 | 7 | 10 | 2026-11-12 / 2026-11-19 | ROTE PROBEN (2): |  |
| 18 | test/nummern/nummerntausch-absender.test.js | 9 | 1 | 8 | 8 | 2026-11-10 / 2026-11-15 | test failed |  |
| 19 | test/gemeinsam/mcp-kompatibilitaetsvertrag.test.js | 7 | 0 | 7 | 6 | 2026-11-17 / 2026-11-17 | Expected values to be strictly deep-equal: |  |
| 20 | test/utils/anbieter-aufrufe-preis-lesen.test.js | 6 | 1 | 5 | 5 | 2026-11-13 / 2026-11-15 | test failed |  |
| 21 | test/gemeinsam/migrationen-sperre.test.js | 5 | 1 | 4 | 5 | 2026-11-11 / 2026-11-19 | Expected values to be strictly equal: (erwartet true, erhalten false) |  |
| 22 | test/ausfallproben/ausfallprobe-meldet-gruen-oder-rot-und-bleibt-lokal.test.js | 5 | 3 | 2 | 5 | 2026-11-12 / 2026-11-19 | "Cannot read properties of undefined (reading 'umgebung')" |  |
| 23 | test/betrieb/dashboard-panels.test.js | 5 | 0 | 5 | 4 | 2026-11-12 / 2026-11-12 | hermes.queue.length: kein Panel in docs/betrieb/grafana/dashboard.json (erwartet 0, erhalten 1) |  |
| 24 | test/gemeinsam/messwerte-gehen-an-otlp.test.js | 4 | 1 | 3 | 4 | 2026-11-10 / 2026-11-10 | https ohne Benutzerangabe baut eine Verbindung auf (erwartet true, erhalten false) |  |
| 25 | test/anrufe/el-inbound-verhalten.test.js | 4 | 1 | 3 | 4 | 2026-11-12 / 2026-11-19 | Expected values to be strictly deep-equal: |  |

Rest (Rang 26–81): stopp-weist-aussen-ab-und-laesst-interne-spruenge-durch 3; ausfall-meldung-als-vorfall 3; sweep-fabrik-vertrag 3; anrufende-messung 3; statusroute-meldet-fruehwarnung 3; store-pg 3; grenzen-stufe1 3; 3365-vorspann-transkript-messung 2; pruefen-lokal-schnell 2; ausgabenwarnung-als-vorfall 2; widget-anruffolge-kommandozeile 2; widget-ergebnis-im-rahmen 2; ausfallprobe-elevenlabs-langsam-meldet-gruen-oder-rot 2; leitungsplaetze-zwei-prozesse 2; widget-ergebnis-failed-und-satz 2; 3266-a3-init-bearbeitungszeit 2; webhook-zustellung-abbruch 2; webhook-idempotenz-ablage-grenze 2; widget-im-rahmen-spaet-stimmig 2; klingelfrist-vorspann-4898 2; nutzung-auffrischen-zwei-prozesse 2; 3365-vorspann-fristen 1; 3365-vorspann-waehlen 1; 3365-vorspann-transkript-messung 1; budget-reserve-zwei-prozesse 1; widget-anruffolge-fenster 1; ausfallprobe-postgres-neustart-rot-belegt-kindausgabe-und-messungen 1; ausfallprobe-postgres-neustart-rot-gibt-kindausgabe-zeilenweise-aus 1; anbieter-aufrufe-lesen-webhook 1; webhook-zustellung-echtheit 1; widget-anruffolge-layout-shift-fenster 1; rueckfrage-staende-am-echten-server 1; 3395-routen-consult-verhalten 1; boot-prod-footguns 1; eroeffnung-anlasszeile-aussagesatz 1; webhook-zustellung-gleichzeitig 1; betriebsmeldungen-gehen-als-vorfall-an-better-stack 1; deepseek-signal 1; deepseek-wachen 1; webhook-zustellung-uebernahme 1; llm-recherche-verhalten 1; kv-p2-inbound-budget 1; vorgaenger 1; sperre-zwei-prozesse 1; budget-reserve-vor-verbrauch 1; 3365-vorspann-erzeugen 1; 3365-vorspann-el-bein 1; ziel-erreicht-nach-auftrag 1; inbound-routing 1; anrufe-mandanten-postgres 1; anbieter-aufrufe-anrufsteuerung 1; openai-s3-place-call-idempotenz 1; profiles 1; stripe-ereignis-register-fehlerwege 1; ausfallprobe-postgres-neustart-rot-wenn-hermes-endet 1; schutz-limits-neustart-postgres 1.

Zusätzlich 20 rote Testjobs, in deren Log kein Testname stand (Job-Abbruch/Absturz vor der Zusammenfassung), nicht in der Rangliste.

### Anteil an den Rückläufen

- Rote CI-Versuche in PR und Queue: 1.889. Davon Tests 1.356, Mutation 508, Lastlauf 106, Prüfungen 90, Rotprobe 82, Semgrep 28 (ein Versuch kann mehrere Jobs rot haben).
- Wackler-Läufe 634 (A 171, B 463) = 34 % aller roten Versuche und 47 % der Versuche mit rotem Testjob (634 von 1.356).
- Merge-Queue: 463 von 581 roten Läufen (80 %); jeder davon kostet einen neuen Queue-Durchlauf (~10–25 Minuten, siehe #4454).
- Wiederholungen: 518 Läufe wurden wiederholt, 218 endeten grün (42 %). Mutation-Jobs wurden 53-mal durch Wiederholung grün (nicht untersucht, kein Teil dieses Auftrags).

### Verlauf je Tag (Queue-Läufe / davon rot / Wackler A / Wackler B)

| Tag | Queue | rot | A | B |
|---|---|---|---|---|
| 10.11. | 99 | 20 | 13 | 18 |
| 11.11. | 67 | 10 | 2 | 10 |
| 12.11. | 243 | 82 | 44 | 72 |
| 13.11. | 143 | 31 | 18 | 26 |
| 14.11. | 105 | 22 | 13 | 6 |
| 15.11. | 261 | 100 | 21 | 98 |
| 16.11. | 198 | 40 | 14 | 34 |
| 17.11. | 436 | 183 | 23 | 108 |
| 18.11. | 241 | 79 | 17 | 77 |
| 19.11. | 74 | 14 | 6 | 14 |

Häufungen in kurzen Fenstern: gedaechtnis-zwei-instanzen-eingang (15.11. 06–17 Uhr: 69 von etwa 150 Queue-Läufen, 46 %) und leitungsplaetze-elevenlabs-freigabe (17.11. 11–14 Uhr: 59 von etwa 194 Queue-Läufen, 30 %). Beides sind Raten, die ein Wackler bei hoher Last erklärt; ein dauerhaft kaputter master würde nahe 100 % zeigen. Beide Tests waren nur Stunden alt (13.11./15.11. eingeführt).

## Teil 2: Herkunft (wann der Test geschrieben wurde)

| Testdatei | Fälle | Test/Datei eingeführt (Commit) |
|---|---|---|
| test/anrufe/webhook-zustellung-nachlauf-zweifach.test.js | 84 | 2026-11-15 49e9df3f Testlücke geschlossen: Anspruchs-ROLLBACK nach Fristablauf w |
| test/anrufe/leitungsplaetze-elevenlabs-freigabe.test.js | 83 | 2026-11-13 c047c41f Absicherung: ElevenLabs-Leitungsplatz bleibt nach Abbruch, B |
| test/einstellungen/gedaechtnis-zwei-instanzen-eingang.test.js | 74 | 2026-11-15 47c15019 Test: Gedaechtnis-Einstellung am Eingang POST /api/calls auf |
| test/anrufe/ausfall-erholung-schliesst-vorfall.test.js | 45 | 2026-11-15 e9ad307e Betreiber: erholt sich ein gemeldeter Telefonie-Ausfall, sch |
| test/gemeinsam/widget-anruffolge-attrappe.test.js | 39 | 2026-11-08 9b0cb7f5 test: Anruffolge der Anrufkarte mit Host-Attrappe abspielbar |
| test/ausfallproben/ausfallprobe-postgres-neustart-meldet-gruen-oder-rot.test.js | 38 | 2026-11-12 b9dc404b Ausfallprobe postgres-neustart: Launch-Abnahme belegt Hermes |
| test/rueckfrage/zusammenfassung-bei-done.test.js | 30 | 2026-11-12 7bcf372f await_call_event antwortet innerhalb der Haltezeit, auch wen |
| test/anrufe/telefonie-waechter-verhalten.test.js | 29 | 2026-11-12 29622c5e Tests: Alarm-SMS, Ausfall-Melder und Absender-Nachmessung ue |
| test/werkzeuge/mutation-zeilen-abdeckung.test.js | 25 | 2026-11-09 c93041ce Mutation: Werkzeugtests für Reihenfolge je Mutant über mutan |
| test/anrufe/anruf-eroeffnung-postgres.test.js | 20 | 2026-11-16 cdb27c66 Test: Anruferöffnung gegen echtes Postgres belegt, dass abge |
| test/anrufe/elevenlabs-ende-messung.test.js | 20 | 2026-11-14 4c23194a Betriebsmessung: nie angenommene oder vom Anbieter abgelehnt |
| test/anrufe/schutz-bei-ausgehenden-anrufen.test.js | 19 | 2026-10-14 9d817ab0 Teste die Sicherheitsgates auf dem ElevenLabs-Weg ausgehend |
| test/gemeinsam/widget-anruffolge-fenstergrenze.test.js | 17 | 2026-11-09 138c7573 test: Fenstergrenze-Messung prüft Strukturbedingungen statt  |
| test/iel-b8-weiche.test.js | 15 | 2026-09-15 3fcbe071 feat(iex-a2): Fehlersatz statt Budget-Rueckfall, keine Benac |
| test/anrufe/schutz-dauer-und-wache-postgres.test.js | 14 | 2026-11-07 ef89bf80 Höchstdauer, Geld-Wache und Kostendecke gegen den Postgres-S |
| test/anmeldung/login-bremse-ausfall.test.js | 12 | 2026-11-10 bcec88a4 Anmelde-Bremse antwortet bei Datenbankstau mit 503 statt 500 |
| test/ausfallproben/ausfallprobe-alle-meldet-gesamtergebnis.test.js | 11 | 2026-11-12 01be298a Ausfallproben: Probe fuer Deploy bei offener Anfrage, Sammel |
| test/nummern/nummerntausch-absender.test.js | 9 | 2026-11-07 284cf2b5 Ersatznummer als Absender und einmaliger Monatsbeleg sind ue |
| test/gemeinsam/mcp-kompatibilitaetsvertrag.test.js | 7 | 2026-09-27 f0961035 Merge T2-18: Kompatibilitaetsvertrag und Update-Runbook (T-3 |
| test/utils/anbieter-aufrufe-preis-lesen.test.js | 6 | 2026-11-11 76bee6d2 Stripe-Lesevorgaenge (Abo, Zahlart, Preis) werden mit Dauer  |
| test/gemeinsam/migrationen-sperre.test.js | 5 | 2026-11-11 8d26091e Zwei Instanzen migrieren dieselbe Datenbank nacheinander: de |
| test/ausfallproben/ausfallprobe-meldet-gruen-oder-rot-und-bleibt-lokal.test.js | 5 | 2026-11-12 38cd9a79 Ausfallprobe elevenlabs-aus: Launch-Abnahme belegt Hermes be |
| test/betrieb/dashboard-panels.test.js | 5 | 2026-11-12 7c10dcf3 Betrieb: CI prüft, dass das Dashboard zu jeder gelieferten K |
| test/gemeinsam/messwerte-gehen-an-otlp.test.js | 4 | 2026-11-03 a51d5fc4 Die Adresse der Messwerte wird nach dem Host beurteilt |
| test/anrufe/el-inbound-verhalten.test.js | 4 | 2026-11-12 9f89df62 Tests: Rueckfall, Fristen und Umleitung der eingehenden Elev |
| test/gemeinsam/stopp-weist-aussen-ab-und-laesst-interne-spruenge-durch.test.js | 3 | 2026-11-08 fc78a936 Deploy bricht laufende MCP-Anrufe nicht mehr ab, Aussenwelt  |
| test/anrufe/ausfall-meldung-als-vorfall.test.js | 3 | 2026-11-14 5e0d2239 Telefonie-Ausfall und haengende Rufnummern-Freigabe gehen al |
| test/abrechnung/sweep-fabrik-vertrag.test.js | 3 | 2026-11-14 2bf75d9d Tests des Sweep-Takts hängen an bestehenden Dateien, damit s |
| test/anrufe/anrufende-messung.test.js | 3 | 2026-11-13 7acec6a7 Betrieb sieht, wie Anrufe enden: Zähler nach Richtung, Ergeb |
| test/gemeinsam/statusroute-meldet-fruehwarnung.test.js | 3 | 2026-11-18 05019d59 Status und healthz zählen abgewiesene Webhooks und hängende  |

| Einführung | Dateien | Fälle |
|---|---|---|
| vor 10.11. | 35 | 182 |
| 10.–15.11. (Beschluss, keine Sperre) | 41 | 493 |
| ab 16.11. (Sperren aktiv) | 5 | 29 |

Ab 16.11.: anruf-eroeffnung-postgres (16.11., 20 Fälle, Datenbank-Pool ohne Fehlerbehandlung), statusroute-meldet-fruehwarnung (18.11., 3), widget-im-rahmen-spaet-stimmig (16.11., 2), klingelfrist-vorspann-4898 (17.11., 2), nutzung-auffrischen-zwei-prozesse (16.11., 2).

### Warum die Regeln nicht griffen (Zeitleiste und Lücken)

- 09./10.11.: Beschluss gemeinsame Uhr (#3639, geschlossen 10.11.) war ein Beschluss und eine Hilfe (`jumpClock`), keine Sperre. Die Umsetzung blieb als Häppchen offen (#3806 weiter offen). Zwischen 10.11. und 15.11. entstanden 41 betroffene Dateien.
- Bis 15.11. 18:48 erlaubte `echtWarten` echte Wartezeit in neuen Tests (Regel von 03.10.). Erst `kein-echt-warten` sperrte es, mit eingefrorener Liste (10 Dateien aktuell).
- `zeitglieder-in-tests` (ESLint) sperrt `setTimeout`/`setInterval` und Timer-Module in `test/**`, aber nicht `Date.now`, `performance.now`, `new Date()` und nicht die Wartehelfer selbst: `waitUntil` (test/helpers.js, Frist per `Date.now`), `bisBedingung`, `zeilenBis`. Das Wartehelfer-Muster wird von 158 Testdateien benutzt, 254 Testdateien lesen die Wanduhr. Die Regel ist damit erfüllt, während der Test an einer festen Frist hängt (z. B. 20 s in webhook-zustellung-nachlauf-zweifach).
- `uhr-als-wert` (seit 16.11.) gilt nur für `src/telephony/**` und `src/elevenlabs/**`; acht Dateien stehen in der eingefrorenen Bestandsliste, darunter `call-lifecycle.ts` (dort tickt die Budget-Wache, die S22 und andere Tests kippt, #5069) und `outage-report.js`. Außerhalb des Bereichs (z. B. src/billing, src/store, src/routes) liegen laut Suche weitere ~100 Zeitleser, die nicht erfasst sind.
- Testschutz prüft Löschen/Abschwächen von Tests, nicht Stabilität. Rotprobe prüft, dass neue Tests ohne die Änderung rot werden, nicht, dass sie unter Last grün bleiben. Der Prüfer liest einen Diff, sieht aber nur den Lauf, in dem der Test einmal grün war: der neue Test war beim Merge grün (die Wackler fielen mit 30–50 % Rate erst in den folgenden Queue-Läufen anderer PR auf).
- Wiederholte Muster: (1) neuer Test mit echtem src-Zeitgeber (Wache 1 s, Nachladefrist 1,5 s, Takt) und Prüfung direkt nach dem Ereignis; (2) Messung gegen die Wanduhr mit knapper Grenze (S14: 10,034 s bei Grenze 10 s); (3) Datenbank-Pool oder Verbindungszählung ohne Fehler-/Teardown-Behandlung; (4) mehrstufige Reparatur über Stunden (gedaechtnis: 10 Commits an einem Tag, 74 Fälle); (5) mehrfache Reparaturen am selben Test (webhook-zustellung: #4316, #5406, #5423 geschlossen, der Test fiel trotzdem noch am 19.11. 01 Uhr UTC, Stand danach nicht gemessen).

## Teil 3a: Top 10, Ursache und Reparatur (je ein Satz)

| # | Test | Fälle | Zuletzt rot | Ursache | Reparatur |
|---|---|---|---|---|---|
| 1 | webhook-zustellung-nachlauf-zweifach | 84 | 2026-11-19 | Wartet mit fester Zeitgrenze (5 s / 20 s) auf SQL-Anweisungen der Anspruchsverbindung und zählt eine fremde Höchstdauer-Verbindung mit. | Anspruchsverbindung über ihre Sitzung erkennen statt Anweisungen zu zählen und auf das Ereignis warten (#5425, #4886). |
| 2 | leitungsplaetze-elevenlabs-freigabe | 83 | 2026-11-17 | Budget-Wache tickt real im 1-s-Takt ab Anrufstart; unter Last endet der Anruf vor call.answered, und der Seed lässt vor dem Abheben nur 10 ct Luft. | Wache über die gemeinsame Uhr steuern und das Seed-Budget so setzen, dass die Wache vor dem Abheben nie greift (#5069, #5071). |
| 3 | gedaechtnis-zwei-instanzen-eingang | 74 | 2026-11-15 | Test hing an der echten 1,5-s-Nachladefrist und las die Logzeile einmalig. | Behoben am 15.11. 18:20 (Frist simuliert); seitdem nicht mehr rot. |
| 4 | ausfall-erholung-schliesst-vorfall | 45 | 2026-11-16 | Wartet auf die falsche Takt-Runde des Melde-Takts, echte Fristen im Test. | Takt über die gemeinsame Uhr treiben, auf Ereignis warten (#4878). |
| 5 | widget-anruffolge-attrappe | 39 | 2026-11-15 | Anruffolge im Browserbild: Ergebnistext fehlt im ersten Lauf, wenn Ladephase und Wanduhr-Messung unter Last gegeneinander laufen. | Szenen am Ereignis statt an der Ladezeit messen (#4287). |
| 6 | ausfallprobe-postgres-neustart-meldet-gruen-oder-rot | 38 | 2026-11-15 | /healthz kommt nach Postgres-Neustart nicht innerhalb der 30-s-Schwelle zurück; Zustandswarten pollt ohne Ereignis. | Auf die Bereit-Meldung des Prozesses warten statt zu pollen (#4670, #5469). |
| 7 | zusammenfassung-bei-done | 30 | 2026-11-14 | Abfrage kommt vor der Zusammenfassung an („Noch keine Zusammenfassung“). | Erst die Zusammenfassung speichern, dann Abfrage freigeben, kein Wanduhr-Vergleich (#4286 geschlossen; seit 14.11. nicht mehr rot). |
| 8 | telefonie-waechter-verhalten | 29 | 2026-11-12 | Echter Wachtakt, Prüfung direkt nach dem Ereignis ohne Warten. | Behoben (#4032); seit 12.11. nicht mehr rot. |
| 9 | mutation-zeilen-abdeckung | 25 | 2026-11-12 | Startet Kindprozesse mit Fristen und räumt sie bei Rot nicht auf. | Kind mit eigener Frist und Aufräumen bei Rot (#4632, #3694); seit 12.11. nicht mehr rot. |
| 10 | anruf-eroeffnung-postgres | 20 | 2026-11-16 | Pool ohne error-Handler; der Teardown beendet Leerlauf-Verbindungen und der Pool wirft unbehandelt. | Behoben (#4815/#4817); seit 16.11. nicht mehr rot. |

Außerdem Rang 11 elevenlabs-ende-messung (20 Fälle, zuletzt 19.11.): Annahmezeit gegen die echte Uhr gemessen (10,034 s bei Grenze 10 s). Reparatur: Annahmezeit aus übergebener Uhr ableiten (#5350, #5163).

Noch lebendig (rot am oder nach dem 17.11.): webhook-zustellung-nachlauf-zweifach (19.11.), elevenlabs-ende-messung (19.11.), schutz-dauer-und-wache-postgres (19.11., #5137), ausfallprobe-alle-meldet-gesamtergebnis (19.11.), migrationen-sperre (19.11.), el-inbound-verhalten (19.11., #4050), schutz-bei-ausgehenden-anrufen (18.11., #5392 geschlossen). Die anderen der Top 10 sind seit mindestens 16.11. nicht mehr rot (gedaechtnis, telefonie-waechter, zusammenfassung-bei-done, mutation-zeilen, anruf-eroeffnung, leitungsplaetze: letzter Fall 17.11.).

Die Ursachen sind aus Issues, Fehlermeldungen und Quelltext abgeleitet, nicht in einem Wiederholungslauf bewiesen. Zu den noch offenen Issues sind kurze Kommentare mit den Messzahlen angelegt (siehe unten); neue Issues wurden nicht angelegt, weil zu jedem lebenden Wackler schon ein offenes Issue besteht.

## Teil 3b: Eine Absicherung gegen neue Wackler

**Vorschlag: `uhr-als-wert` lückenlos machen, statt etwas Neues zu bauen.** Die Regel legt schon den erlaubten Weg fest (Zeit kommt als Wert vom Aufrufer; Tests steuern sie mit `t.mock.timers` oder `now`), sitzt in `eslint.config.js` (vorhandener Platz), nutzt die vorhandene eingefrorene Bestandsliste und die Gate-Zeile „Eingefrorene Bestände wachsen nicht“. Sie hat drei Lücken, die genau die Wackler erzeugen:
1. Geltungsbereich nur `src/telephony/**` und `src/elevenlabs/**`: auf alle Quellordner erweitern, in denen Fristen/Takte laufen (billing, store, routes, anrufe), jeweils mit eingefrorener Liste der heutigen Treffer (rund 100 Zeilen in src/billing, store, routes, anrufe).
2. Bestandsliste (8 Dateien) enthält `call-lifecycle.ts` (Budget-Wache) und `outage-report.js`: Die Liste darf nur schrumpfen; die Wache zuerst abbauen (#5069 ist das erste Häppchen), das beseitigt den Zeitgeber, an dem S22 und die Geld-Wache-Tests hängen.
3. Tests: `Date.now`, `performance.now`, `new Date()` ohne Argument und `process.hrtime` in `test/**` mit demselben Bestand verbieten (254 Dateien eingefroren), Wartehelfer ausgenommen. Erlaubter Weg: `jumpClock`/`t.mock.timers`/Ereignis. Dazu `waitUntil` nur mit Ereignis (Entscheidung offen in #3806).

Prüfung gegen die vier Punkte: (1) legt einen erlaubten Weg fest (Uhr als Wert) statt einen Einzelfall zu verbieten; (2) sitzt an vorhandenem Platz (ESLint, Bestandsliste in tools/basis); (3) hebt keine Obergrenze (kein neuer Job, keine zusätzliche Zeit bis Merge: Lint läuft ohnehin); (4) doppelt nichts: erweitert `uhr-als-wert` und `zeitglieder-in-tests` und ersetzt deren Lücken. Wirkung nach den Daten: Wackler mit Wanduhr-Bezug stehen für 312 von 704 Fällen (44 %), aus Tests ab 10.11. 261 von 522 (50 %). Nicht erfasst bleiben Datenbank-Pool/Prozess/Reihenfolge (anruf-eroeffnung, login-bremse, postgres-neustart): dafür gibt es keine Absicherung in diesem Vorschlag, weil seit 16.11. nur noch 20 Fälle daraus stammen.

Alternative bei Bedarf: der Rest der Wackler-Klasse Datenbank (46 Testdateien bauen selbst `new Pool/Client`, 34 nutzen die Testrolle `test-rolle`) ließe sich mit „Datenbank in Tests nur über `echteDatenbank`“ absichern; zurückgestellt, weil die Datenlage klein ist.

## Verfahren: Wackler laufend aus vorhandenen Läufen messen (ohne neuen Workflow)

Ein Skript (Platz: `tools/` oder bei Engineering, nicht in Actions) läuft auf dem Server per vorhandenem Wacht-Takt einmal je Stunde und liest nur, was GitHub schon hat:
1. `gh api repos/sundartha/hermes/actions/workflows/<CI-ID>/runs?created=<tag>` je Tag (bei mehr als 1.000 Läufen je Tag in Zeitfenstern aufteilen, die API kappt bei 1.000).
2. Je Lauf mit `run_attempt>1` oder `conclusion=failure` die Jobs: `actions/runs/<id>/attempts/<n>/jobs`; rote Jobs „Tests …“ → Log `actions/jobs/<id>/logs`, Zeilen „✗ Name (Datei:Zeile)“ und die folgende Zeile.
3. Klasse A (selber Stand, Wiederholung grün) und B (Queue rot, später grün, kein Push) wie oben zählen; je Datei Fälle, erster/letzter Fall, verschiedene PR. Ausgabe: eine Tabelle pro Tag (Datei, Fälle, A/B). Schwellwert: ab 3 Fällen in 24 Stunden Issue-Kommentar am offenen Wackel-Issue der Datei, sonst Hinweis an Engineering.
4. Kein neuer Workflow, keine Wiederholungsläufe auf GitHub: reine Leseabfragen (rund 3.500 API-Aufrufe für zehn Tage, im Takt klein, weil nur neue Läufe).
Die in dieser Messung benutzten Skripte liegen unter /tmp/wk/s/ (flüchtig); sie sind rund 150 Zeilen Python.

## Offene Punkte / Einschränkungen
- Klasse B ist wahrscheinlich, nicht bewiesen (keine PR-Diff-Prüfung je Fall).
- Herkunftsdatum je Test beruht auf Git-Suche nach dem Testnamen; Umbenennungen können das Datum nach vorn verschieben.
- 20 Testjobs ohne Testnamen im Log (Absturz) sind nicht zugeordnet.
- Jobs Mutation/Lastlauf/Rotprobe sind nicht untersucht. Lastlauf war 106-mal rot (Wiederholung nie grün), auf master 20-mal; das ist keine Testwackelei, aber Rückläufe in der Queue.

