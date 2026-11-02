# P-2654 Migrationen je Datenbank genau einmal, versioniert, unter Sperre: Sicherheitsprüfung

Status: freigegeben
Grundlage: pitch.md, design.md (kein Design Doc, nur „Ausgangslage und Annahmen“), Code-Stand 7dc3be8

## Zur Freigabe
1. Die schwersten Angriffswege: T1 (die Zeilensicherheit heilt sich beim Start nicht mehr, ein Ausfall der zweiten Verteidigungslinie zwischen Kunden bleibt still bestehen), T3 (über eine gepoolte Verbindung im Transaktionsmodus läuft eine Migration in einem fremden Kundenbereich, und die Sperre schützt nicht), T2 (eine nach dem Start nicht freigegebene Sperre blockiert jeden späteren Start, auch den Neustart, der `OUTBOUND_FROZEN` scharf schaltet). Entspricht das deiner Einschätzung?
2. Fehlt dir ein Angriffsweg, der dich beunruhigt?
3. Zu entscheiden (alle am 02.11. von der Betreuung entschieden):
   1. T1 — abgelehnt für diese Änderung: kein „verhindern“ hier, sondern übertragen an das Folgepaket #2679 (RLS-Startprüfung, unmittelbar nach dieser Änderung und vor S2a); bis dahin Runbook-Hinweis „Ein Neustart repariert nichts mehr“ und PM8 hingenommen. Ursprünglicher Vorschlag: „verhindern“ gesetzt, obwohl der Pitch dasselbe als PM8 hingenommen hat. Vorschlag: eine fail-closed Startprüfung nach den Migrationen, dass jede Tabelle mit `tenant_id` außerhalb der begründeten Ausnahmen Zeilensicherheit, FORCE und eine Policy hat (Szenario zu T1). Der Pitch bekäme damit ein Szenario und eine Datei mehr. Empfehlung: ja, weil die Änderung die heutige Selbstheilung (`0001_ausgang.sql:1052-1089`, `:1097ff.` bei jedem Start) ersatzlos entfernt und die Prüfung so klein ist wie die vorhandene Rollenprüfung `[F5]` (`src/portal-pool.js:6-36`).
   2. T3 — angenommen: übertragen an den Betreiber; die Härtung (Bereich transaktionslokal) ist abgelehnt. Vorschlag war: übertragen an den Betreiber, weil der Start nur über eine direkte Sitzungsverbindung trägt und das im Code nicht erkennbar ist. Empfehlung: übertragen, dazu die erste offene Frage vor dem Bau klären; zusätzlich kostenlos härten, indem der Bereich innerhalb jeder Migrationstransaktion transaktionslokal gesetzt wird.
   3. T5 — entfällt: die Migrationssperre nimmt die Zwei-Schlüssel-Form `pg_advisory_lock(int4, int4)` und teilt den Schlüsselraum nicht mit dem Login. Vorschlag war: hinnehmen, weil die Folge nur eine kurze Wartezeit ist. Empfehlung: hinnehmen, aber die Begründung von PM9 berichtigen (siehe T5).
   4. T6 — angenommen: übertragen an den Betreiber. Vorschlag war: übertragen an den Betreiber, weil nur ein Rücksprung auf einen Code-Stand vor dieser Änderung den Weg öffnet. Empfehlung: übertragen, mit dem Runbook-Hinweis aus dem Pitch.
   5. Vertrauensannahme für `docs/sicherheitsgrenzen.md` (Abschnitt 5) — angenommen; die Katalogzeile mit dem Negativtest entfällt, sie gehört zum Folgepaket #2679.

## 1. Woran arbeiten wir
### Umfang
Die Änderung berührt nur den Start einer Hermes-Instanz im Postgres-Betrieb: `src/store.js:10-12` erzeugt den Pool und ruft `init()`, das auf einem Client den Plattformbereich setzt und `migrate` aufruft (`src/store/pg.js:32-35`). Neu sind die Versionstabelle `schema_migrations`, eine Prüfsumme je Migrationsdatei, die Advisory-Sperre `72001`, eine Transaktion je Migration und das Zurücksetzen auf den Plattformbereich vor jeder Migration (Pitch, Grobe Lösung, R1 bis R4). Es gibt keine neue Route, kein neues Werkzeug und keinen neuen Webhook (Pitch, Geänderte Dateien); Anrufe, SMS, Transkripte und die Gates in `src/telephony/outbound-gates.js` werden nicht berührt.
### Beteiligte
- Kunde: angemeldet über WorkOS, erreicht den Start nicht. Seine verifizierte E-Mail landet beim ersten Login in einer Transaktions-Advisory-Sperre im selben Schlüsselraum (`src/web-auth.js:289`, `:332-349`).
- Agent des Kunden, Angerufener, Anrufer bei eingehenden Anrufen: keine Berührung; die Änderung verarbeitet keine Anrufe und keine Gesprächsinhalte (Pitch, Grobe Lösung: „Kunden und Angerufene bemerken nichts“).
- Betreiber: setzt `DATABASE_URL` im Render-Dashboard (`render.yaml:327-328`), deployt, arbeitet bei Wiederherstellung von Hand an der Datenbank (`docs/RUNBOOK-RESTORE.md`).
- Inhaber von `DATABASE_URL`: die App-Rolle führt die DDL selbst aus (`src/store/pg.js:35`), ist also angenommen Eigentümerin der Tabellen und kann Zeilensicherheit und Policies ändern.
- Zweite Hermes-Instanz: startet beim Deploy gegen dieselbe Datenbank (Pitch, Problem).
- Anbieter: Render (Deploy, Postgres, angenommen auch ein möglicher Verbindungspool), WorkOS (liefert die E-Mail, T5). Telnyx, ElevenLabs und Stripe sind nicht berührt.
### Eingänge und Grenzen
- Start einer Instanz über `DATABASE_URL`: Grenze Prozess zu Datenbank, mit der Rolle aus `DATABASE_URL`. Beleg: `src/store.js:10-12`, `src/store/pg.js:32-35`, `src/store/pg-runner.js:1-16`. Angriffswege: T1, T2, T4, T6
- Verbindungsweg zur Datenbank (direkt oder über einen Pool im Transaktionsmodus): Grenze Sitzung zu Serververbindung. Beleg: Pitch, Nicht-Ziele (pgBouncer); `docs/RELEASE-GATE-killer-test.md:6`, `docs/RUNBOOK-RESTORE.md:275`. Angriffswege: T3
- Migrationssperre: Advisory-Sperre in der Zwei-Schlüssel-Form (`classid` 72, `objid` 1), die sich nicht mit dem Einzelschlüsselraum des Logins (`src/web-auth.js:289`) überschneidet. Beleg: Pitch, Neue Begriffe, S10, S11. Angriffswege: T2
- Migrationsdateien aus dem Repo in das Produktionsschema: feste Liste im Code (`src/db/migrate.js:11`), kein Ordner per Umgebungsvariable (Pitch, Nicht-Ziele). Angriffswege: keiner neu, weil die Liste nur über einen PR änderbar ist, die CI eine geänderte gemergte Migration ablehnt (`tools/migrationen-pruefen.mjs:149`) und Änderungen an Prüfungen und Code über CODEOWNERS laufen (SG-21)
- Tabelle `schema_migrations` als Grundlage der Startentscheidung: neu. Beleg: Pitch, R1, R2. Angriffswege: keiner neu, weil nur Inhaber eines Datenbankzugangs sie schreiben können und diese das Schema ohnehin direkt ändern können; die Folge des Nicht-mehr-Heilens steht in T1
### Werte
- Mandantentrennung in der Datenbank: Zeilensicherheit mit FORCE ist die zweite Verteidigungslinie hinter dem App-Filter (`0001_ausgang.sql:1048-1051`); fällt sie aus, trifft eine Lücke im App-Filter Anrufe und Transkripte eines anderen Kunden (SG-02).
- Startfähigkeit: `OUTBOUND_FROZEN` wird nur beim Start gelesen (`src/config.js:629`, geprüft in `src/telephony/outbound-gates.js:46`); auch Sicherheitskorrekturen wirken erst nach einem gelungenen Start.
- Bestehende Kundendaten bei der Übernahme (Pitch, S3).
- Verlässlichkeit der Schemahistorie: `schema_migrations` soll sagen, welche Änderungen wirklich gelten.
### Wem wir was glauben
- Postgres: wir glauben, dass eine Sitzungs-Advisory-Sperre nur der einen Serversitzung gehört und dass `set_config(…, false)` bei einem Rollback zurückfällt; wenn nicht, schützen Sperre (R4) und Bereichswechsel (R3) nicht.
- Render: wir glauben (angenommen), dass `DATABASE_URL` eine direkte Sitzungsverbindung ist und dass eine neue Instanz, die nicht gesund wird, die alte nicht ersetzt; wenn nicht, gilt T3, und T2 wird zum Ausfall statt zu einem hängenden Deploy.
- Design Doc, Zeile 2 von „Ausgangslage und Annahmen“: die Sperre „fällt beim Prozessende von selbst“. Das trägt nur bei Fehlern, die den Prozess beenden (`src/store.js:30`). Nach einem gelungenen Start endet der Prozess nicht, der Client geht in den Pool zurück (`src/store/pg-runner.js:13-14`); daraus folgt T2.
- WorkOS: liefert eine verifizierte E-Mail, die der Anmeldende selbst wählt (T5).
### Nicht-Ziele
- Diese Änderung schützt nicht gegen Inhaber von `DATABASE_URL`, weil die App-Rolle Eigentümerin der Tabellen ist und Zeilensicherheit ohnehin selbst abschalten kann; Zeilensicherheit schützt gegen Fehler im App-Filter, nicht gegen Datenbankzugang.
- Gleichzeitiger Betrieb zweier Instanzen über den Start hinaus (Pitch, Nicht-Ziele, PM4): die Kostendecke hängt am Speicher einer Instanz und wird hier nicht für zwei Instanzen abgesichert.
- Wartegrenze für die Sperre (Pitch, Nicht-Ziele): ein unbegrenztes Warten bleibt bis S1c möglich; S14 meldet es nur.

## 2. Angriffswege
### T1: Eine abgeschaltete Zeilensicherheit bleibt nach dem nächsten Start abgeschaltet
Wer: Betreiber oder jeder mit `DATABASE_URL`, etwa bei einer Wiederherstellung oder Fehlersuche von Hand; kein Angreifer von außen
Weg: Heute führt jeder Start `0001_ausgang.sql` ganz aus (`src/db/migrate.js:21-23`, `:178`; fragerunden.md, Vorher-Rot S2) und setzt dabei `ENABLE`/`FORCE ROW LEVEL SECURITY` und die Policies `tenant_isolation` neu (`0001_ausgang.sql:1052-1089`, `:1097-1100` ff.). Nach der Änderung läuft eine eingetragene Migration nie wieder (Pitch, S2), also bleibt ein von Hand entferntes FORCE oder eine entfernte Policy dauerhaft weg. Der Wächtertest prüft nur ein frisch angelegtes Schema, nicht die Produktionsdatenbank (`test/sec-p6-waechter-rls.test.js:40-43`).
Schaden: Die zweite Verteidigungslinie zwischen Kunden ist still aus. Trifft danach ein vergessener App-Filter zu, sieht ein Kunde Anrufe, Transkripte oder Rückfragen eines anderen Kunden, und niemand bemerkt, dass die Datenbank es nicht mehr abfängt.
Ausgang: übertragen an das Folgepaket #2679 (RLS-Startprüfung, unmittelbar nach dieser Änderung, vor S2a), entschieden am 02.11. durch die Betreuung; bis dahin hingenommen (PM8) mit Runbook-Hinweis „Ein Neustart repariert nichts mehr“ in `docs/RUNBOOK-RESTORE.md`. Die Prüfung soll `qual` und `with_check` mit dem Sollzustand vergleichen (Gegenprüfung 1), nicht nur Policies zählen.

### T2: Eine nach dem Start weiter gehaltene Migrationssperre blockiert jeden späteren Start
Wer: kein Angreifer; die laufende Instanz selbst
Weg: Die Sperre wird als Sitzungssperre auf dem Client von `init()` genommen (design.md, Zeile 2). Nach dem Start gibt `withClient` den Client an den Pool zurück, ohne die Verbindung zu schließen (`src/store/pg-runner.js:6-15`); ohne ausdrückliche Freigabe hält diese Verbindung `72001`, solange der Pool sie behält. Die nächste Instanz wartet ohne Zeitgrenze (Pitch, S10, Nicht-Ziel Wartegrenze).
Schaden: Kein Deploy wird mehr gesund, solange die alte Instanz läuft. Damit lässt sich auch `OUTBOUND_FROZEN` nicht per Neustart scharf schalten (`src/config.js:629`), und Sicherheitskorrekturen kommen nicht in Betrieb. Die Anrufpause zur Laufzeit (`src/telephony/outbound-gates.js:48`, `POST /intern/anrufpause`) bleibt als Notaus.
Ausgang: verhindern, weil eine ausdrückliche Freigabe nach dem Lauf die Sperre an das Ende des Starts bindet.
Szenario: S11 im Pitch („nach dem Ende des Starts keine“); ohne Freigabe zeigt `pg_locks` die Sperre nach dem Start weiter.

### T3: Über eine Verbindung im Transaktionsmodus läuft eine Migration in einem fremden Kundenbereich, und zwei Instanzen migrieren zugleich
Wer: kein Angreifer; der Betreiber stellt `DATABASE_URL` auf einen Verbindungspool im Transaktionsmodus, wie ihn `docs/RELEASE-GATE-killer-test.md:6` als „reale Render-Topologie“ und `docs/RUNBOOK-RESTORE.md:275` als Ziel nennen
Weg: Sperre und Plattformbereich hängen an der Serversitzung (Pitch, Nicht-Ziele; PM3). Im Transaktionsmodus kann die Migrationstransaktion auf einer anderen Serververbindung laufen als das vorherige Zurücksetzen des Bereichs; dort kann der Bereich ein anderer sein als der gesetzte, und die Sperre gehört einer Verbindung, die nicht migriert.
Schaden: Eine Migration, die Zeilen schreibt, schreibt sie im Bereich eines beliebigen Kunden, und Daten landen bei der falschen Person. Zwei Instanzen können trotz Sperre zugleich migrieren, oder die Sperre bleibt auf einer Verbindung des Pools stehen (wie T2).
Ausgang: übertragen an den Betreiber (Vorschlag), weil der Code nicht erkennen kann, ob zwischen ihm und Postgres ein Pool im Transaktionsmodus steht, und ein Test in der CI ohne solchen Pool auch ohne Schutz grün wäre. Offen bleibt, dass der Start bei falscher Verbindung nicht abbricht. Den Bereich innerhalb jeder Migrationstransaktion transaktionslokal zu setzen, nimmt den Bereichsteil unabhängig von der Verbindung weg (Härtung ohne eigenes Szenario).

### T4: Eine Migration läuft im Bereich, den die vorige Migration hinterlassen hat
Wer: kein Angreifer; eine künftige Migration, die den Bereich sitzungsweit setzt
Weg: Bisher gibt es nur eine Datei, die im Plattformbereich läuft (`src/store/pg.js:34`). Mit mehreren Dateien auf derselben Sitzung trägt sich ein Bereichswechsel aus einer Datei in die nächste (Pitch, R3, S8).
Schaden: Die nächste Migration liest oder schreibt im Bereich eines anderen Kunden; Daten kommen zur falschen Person.
Ausgang: verhindern, weil R3 jede Migration im Plattformbereich beginnen lässt.
Szenario: S8 im Pitch; ohne das Zurücksetzen stünde „k-fremd“ in der Tabelle. Die Nachzüge nach der letzten Migration hängen nicht am Bereich: `backfillNumberGeo` setzt ihn je Kunde selbst (`src/db/migrate.js:97`), die übrigen schreiben `tenant`, `account` und `profile`, die nicht kundenweise abgeschirmt sind (`0001_ausgang.sql:1052-1089`, `:1129`).

### T5: Ein Login hielt dieselbe Sperrnummer wie der Start (entfallen)
Wer: angemeldeter Kunde beim ersten Login
Weg: Der Login nimmt eine Transaktionssperre auf `hashtext(email)` im Einzelschlüsselraum (`src/web-auth.js:289`); eine Migrationssperre mit fester Einzelnummer läge im selben Raum, und ein Anmeldender kann eine E-Mail mit passendem Hash wählen. Mit bis zu 10 gleichzeitigen Logins füllte er den Portal-Pool (`src/portal-pool.js:39`) und ließe das Dashboard während eines Starts warten (Gegenprüfung 4).
Schaden: Ausfall des Dashboards während eines Starts; keine Daten, keine Kosten.
Ausgang: verhindern, weil die Migrationssperre in der Zwei-Schlüssel-Form `pg_advisory_lock(int4, int4)` genommen wird und sich Ein- und Zwei-Schlüsselraum nicht überschneiden.
Szenario: S11 (liest `classid` 72, `objid` 1, `objsubid` 2).

### T6: Ein Rücksprung auf den Code vor dieser Änderung setzt eine später verschärfte Policy still zurück
Wer: Betreiber beim Rollback über den Deploy-Weg
Weg: Der Code vor dieser Änderung führt `0001_ausgang.sql` bei jedem Start ganz aus und legt dabei jede Policy `tenant_isolation` neu an (`0001_ausgang.sql:1097` ff.), während `schema_migrations` eine spätere Migration, die eine Policy verschärft, weiter als angewendet führt (Pitch, PM6, Nicht-Ziel Rollback).
Schaden: Die Datenbank gilt als verschärft, hat aber wieder die alte, weitere Policy; der Fehler fällt nicht auf, und T1 erkennt ihn nicht, weil eine Policy weiter vorhanden ist.
Ausgang: übertragen an den Betreiber (Vorschlag), weil nur ein bewusster Rücksprung auf einen Stand ohne `schema_migrations` den Weg öffnet; der Pitch legt dafür einen Hinweis in `docs/RUNBOOK-RESTORE.md` an. Offen bleibt, dass der alte Code dabei nichts meldet.

## 3. Lückenprüfung
| Punkt | Ergebnis |
|---|---|
| H1, H6, H7, H9, H11 | trifft nicht zu, weil die Änderung keinen Anruf, kein Gespräch, keinen eingehenden Anruf und keinen ausgehenden Aufruf berührt (Pitch, Geänderte Dateien) |
| H2, H3 | trifft nicht zu, weil die Änderung keinen Vorgang auslöst und die Gates unverändert bleiben (`src/telephony/outbound-gates.js:46-48`); mittelbar T2, weil der Notaus per Umgebungsvariable einen gelungenen Start braucht |
| H4 | trifft zu → T1, T3, T4 |
| H5, H13 | trifft nicht zu, weil keine Tokens berührt werden und kein neuer Schlüssel entsteht; `DATABASE_URL` bleibt, wo es ist (`render.yaml:327-328`) |
| H8 | trifft nicht zu, weil weder Offenlegung noch KI-Kennzeichnung berührt werden |
| H10 | trifft nicht zu, weil kein Webhook berührt wird; das Gegenstück „jede Migration wirkt einmal“ ist R1 und R4 |
| H12 | trifft nicht zu, weil die Übernahme Daten nicht anfasst (S3) und Fehlermeldungen über die zentrale Logmaske laufen (`src/log-maske.js`, SG-13); angenommen ist, dass die Meldung den Primärtext des Postgres-Fehlers trägt und nicht dessen Detail mit Werten (offene Frage) |
| H14 | trifft nicht zu, weil kein neues Paket hinzukommt (Pitch, Geänderte Dateien); angenommen ist, dass die Prüfsumme aus `node:crypto` kommt |
| H15 | siehe „Wem wir was glauben“; berührt sind nur Postgres und Render |
| STRIDE an der Grenze Start zu Datenbank (Migrationslauf, `schema_migrations`, Bereichswechsel) | Tampering → T1, T6; Information Disclosure (Daten im falschen Bereich) → T3, T4; Elevation of Privilege → T4. Spoofing ohne Weg, weil der Start nur sich selbst gegenüber der Datenbank ausweist und keine Identität annimmt; Repudiation ohne Weg, weil die Deploy-Historie bei Render zeigt, wann welcher Stand lief; Denial of Service siehe nächste Zeile |
| STRIDE an der Grenze zwischen Instanzen und Sitzungen (Migrationssperre) | Denial of Service → T2; T3 für den Fall eines Pools im Transaktionsmodus. Wer die Sperre absichtlich hält, braucht einen Datenbankzugang und kann ohnehin mehr; übrige Kategorien ohne Weg, weil die Sperre nichts trägt außer „wer migriert“ |
| LINDDUN für die angerufene Person | trifft nicht zu, weil die Änderung weder Stimme noch Worte noch Nummern der angerufenen Person liest, schreibt oder ausgibt; Transkripte bleiben bei der Übernahme stehen (S3), und T3/T4 betreffen Zeilen künftiger Migrationen, nicht vorhandene Gesprächsdaten |

## 4. Offene Fragen
- Angenommen: `DATABASE_URL` in Produktion ist eine direkte Sitzungsverbindung, kein Pool im Transaktionsmodus; die Release-Gate-Doku beschreibt das Gegenteil (`docs/RELEASE-GATE-killer-test.md:6`). Ändert: T3, T2. Prüfen durch: der Betreiber sieht im Render-Dashboard nach, ob der Verbindungsstring auf die Datenbank selbst oder auf einen Pooler zeigt, ohne das Geheimnis zu kopieren.
- Angenommen: Eine neue Instanz, die nicht gesund wird, ersetzt die alte bei Render nicht. Ändert: Schaden von T2 und von T1s Exit 1 (hängender Deploy statt Ausfall). Prüfen durch: Render-Dokumentation zu Deploys ohne Ausfallzeit und Health-Check-Zeitgrenze.
- Angenommen: Die App-Rolle aus `DATABASE_URL` ist Eigentümerin der Tabellen. Ändert: „Wer“ in T1. Prüfen durch: Eigentümer der Tabellen in einer Kopie der Struktur der Produktion ablesen (design.md, Zeile 6 nennt diese Kopie schon).
- Angenommen: Die Fehlermeldung bei Exit 1 enthält den Primärtext des Postgres-Fehlers, nicht dessen Detail mit Schlüsselwerten. Ändert: H12. Prüfen durch: im Bau nachsehen, welche Felder des Fehlers in die Meldung gehen (`src/store.js:25-29`).

## 5. Vorschlag für docs/sicherheitsgrenzen.md
Neue Katalogzeile (nur der Teil zu R3; der Teil „startet, obwohl eine Tabelle ohne FORCE oder Policy ist“ gehört zum Folgepaket #2679): Ein Start wendet eine Migration in einem fremden Kundenbereich an. Verletzte Grenze: Mandantentrennung in der Datenbank gilt unabhängig davon, welche Migrationen eine Datenbank schon hat. Mechanismus: Plattformbereich vor jeder Migration (R3). Negativtest: S8.
Neue Vertrauensannahme: `DATABASE_URL` ist eine direkte Sitzungsverbindung; Migrationssperre und Plattformbereich beim Start hängen daran.
Kein neuer gemeinsamer Wert: die Migrationssperre liegt in der Zwei-Schlüssel-Form und teilt sich keinen Schlüsselraum mit dem Login.

## 6. Gegenprüfung
| Nr. | Art | Bezug | Befund mit Beleg | Übernommen als |
|---|---|---|---|---|
| 1 | Schutz umgangen | T1 | Die vorgeschlagene Startprüfung (Zeilensicherheit, FORCE, eine Policy) ist so schwach wie der Wächtertest (`test/sec-p6-waechter-rls.test.js:19-20`, `:38`). Ein `ALTER POLICY tenant_isolation ON call USING (true) WITH CHECK (true)` bleibt unbemerkt; `profile` hat bewusst `USING (true)` (`0001_ausgang.sql:1127-1129`). | Startprüfung (Folgepaket #2679) vergleicht `qual` und `with_check` aus `pg_policies` mit dem Sollzustand (Scratch-PGlite wie `scripts/lib/pg-schema-abgleich.mjs:19-28`), lehnt jede zusätzliche Policy ab, erlaubt `USING (true)` nur für die ausdrücklich genannten globalen Tabellen; zweites Szenario `ALTER POLICY … USING (true)` → Exit 1 mit `call`. Entschieden am 02.11.: übertragen an das Folgepaket #2679 (Punkt 3.1), der Sollzustand-Vergleich ist dort der Auftrag. |
| 2 | Szenario prüft nicht | T2 / S11 | Der Pool hat keinen `idleTimeoutMillis` (`src/store/pg-runner.js:3`); der Standard von node-postgres schließt Verbindungen nach 10 s Leerlauf, und die Sperre verschwindet dann auch ohne Freigabe. S11 ohne Zeitpunkt wäre auch ohne Freigabe grün. | Übernommen: Zeitpunkt in S11 festgelegt („unmittelbar nach dem ersten 200, spätestens 5 Sekunden danach, ohne Wiederholung“). |
| 3 | Szenario prüft nicht | T4 / S8 | Die Migrationsliste ist fest im Code; `0003`/`0004` sind über `npm start` nicht einspielbar, und „vom Test nachgebildet“ ließ eine Lesart zu, in der der Bereich auf der Testverbindung gesetzt wird und die Instanz ihn nie sieht. | Übernommen: S8 und S6 umgeschrieben; der Wrapper um die Verbindung des Starts (`{ query, exec }`, wie der Kurzauftrag S1db es vorsieht) stellt den Bereich nach `0001` um und liest ihn zu Beginn von `0002`; ohne das Zurücksetzen (R3) wird er rot. |
| 4 | widerlegt | T5 | „Andere Kunden sind nicht betroffen“ stimmt nicht: Login und Sitzungsprüfungen nutzen den Portal-Pool mit höchstens 10 Verbindungen (`src/portal-pool.js:39`, `src/wiring/web-login.js:100-106`); ein offline gefundener Treffer von `hashtext` auf 72001 kann sie während eines Starts füllen. Nur Ausfall des Dashboards, keine Daten oder Kosten. | Übernommen am 02.11.: Migrationssperre in der Zwei-Schlüssel-Form `pg_advisory_lock(int4, int4)`; T5 entfällt, S10, S11, S14 lesen `classid`/`objid`/`objsubid = 2`. |
