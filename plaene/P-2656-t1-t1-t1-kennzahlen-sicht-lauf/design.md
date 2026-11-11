# P-2656 Kennzahlen-Sichten: Design Doc

Status: freigegeben
Pitch: plaene/P-2656-kennzahlen-sichten/pitch.md
Entscheidung: Schema, Sicht, Zeilenschutz-Regel und Rechte stehen ohne `DO`-Block in einer neuen, nur erweiternden Migration. `applySchema` führt sie nur aus, wenn es die Rolle `kennzahlen_leser` gibt, überspringt sie bei fehlendem Recht (SQLSTATE `42501`) mit einer Logzeile und setzt vor jeder Migration `SET LOCAL lock_timeout`. Über alle Mandanten zählt die Sicht der App-Rolle nur für die Sitzung `kennzahlen_leser`, ohne `BYPASSRLS`, und melden darf nur der Prozess, der eine Sitzungssperre hält.

## Zur Freigabe
1. Kein `BYPASSRLS`. Die Sicht `kennzahlen.messwerte` gehört der App-Rolle. Die nur lesende Regel `kennzahlen_lesen` auf `call` gibt Zeilen aller Mandanten nur für die Sitzung `kennzahlen_leser` frei. Umkehrbar (Regel, Schema und Rolle lassen sich löschen). Entschieden von Antonio am 02.11.; unverändert übernommen.
2. Migrationsweg, neu wegen PR #2734: Alle Kennzahlen-Teile stehen auf oberster Ebene der neuen Migration, damit Squawk jede Anweisung sieht. `src/db/migrate.js` bekommt drei Änderungen, nicht eine Zeile:
   - den Eintrag der Migration;
   - die Bedingung „nur, wenn die Rolle `kennzahlen_leser` existiert“ und das Überspringen bei `42501` mit Logzeile (B3, PM1);
   - `SET LOCAL lock_timeout` vor jeder Migration, auch vor `0001` (S27).
   Umkehrbar. Empfehlung: ja. Der Weg trägt bei „jeder Start“ und bei „genau einmal“, ohne dass der Betreiber Rechte von Hand vergibt, und er versteckt nichts vor der Migrationsprüfung.
3. Werte: `lock_timeout` 5 s für jede Migration und `statement_timeout` 10 s in der neuen Migration. Umkehrbar. Empfehlung: ja. S27 begrenzt den Start auf 10 s; laut Postgres-Doku ist `lock_timeout` nur unterhalb von `statement_timeout` wirksam. Die 5 s stammen aus dem schon freigegebenen Stand (G1). Der Pitch nennt keinen Wert.
4. Gestrichen gegenüber dem alten Stand: Die Sicht liefert für andere Rollen keine Leerantwort mehr, und der Lauf hat keinen Zweig für eine leere Antwort. Grund: S20 erfüllt schon die Rollenprüfung des Laufs, und das feste Raster liefert für `kennzahlen_leser` immer 25 Zeilen.
5. Ungeprüfte Annahmen:
   - Die App-Rolle hat `CREATEROLE` und `CREATE` auf der Datenbank.
   - Squawk erkennt `SET LOCAL` als Zeitgrenze und meldet bei `CREATE SCHEMA`, `CREATE VIEW`, `CREATE POLICY`, `GRANT` und `REVOKE` in der Standardeinstellung nichts weiter.
   - B3 bietet einen beobachtbaren Messwert ohne Label je Prozess.
   - `KENNZAHLEN_DATABASE_URL` zeigt direkt auf Postgres.

   Geschlossen (Sitzung, nach der Prüfung des Plans): Produktion läuft mit Postgres 16.14 (`infrastruktur-audit-20261030` F-28), PGlite 0.5.8 mit Postgres 18.3 (gemessen mit `SHOW server_version`). Beide kennen `pg_input_is_valid`.

   Folgen: siehe Ausgangslage.
6. Vorschläge an den Pitch, angenommen am 02.11. (Betreuung): S22 und S27 geschärft, neues Szenario B5 (fehlendes Recht bei vorhandener Rolle), Zeilenbelege zu `src/db/migrate.js` richtiggestellt.
7. Aus der Sicherheitsprüfung, angenommen am 02.11. (Betreuung): Die Migration setzt `ALTER ROLE kennzahlen_leser CONNECTION LIMIT 2` (Migration, Anweisung 6); nimmt die Migrationsprüfung es nicht an, wird T3 als „erkennen“ eingestuft, nie umgangen. Neue Szenarien S30, S31, S32 und B6. Kein `REVOKE … FROM PUBLIC` (T1 Teil b ist „erkennen“). Rückweg vollständig beschrieben (Rückweg unten). T9 (lock_timeout 5 s vor `0001` kann Deploys bei langer Schreibtransaktion scheitern lassen) ist hingenommen mit der Bedingung, die Flush-Dauer vor dem Einschalten zu messen.
8. Neu, entschieden von Antonio am 02.11.: Start des Minutentakts, Lesen der Momentaufnahme und Auslösen eines Takts gehen über die Fassade `src/store.js`. Sie reicht dafür `starteKennzahlenLauf`, `kennzahlenMomentaufnahme` und `kennzahlenTakt` aus `src/store/kennzahlen.js` weiter. `src/boot.js` und Tests importieren `src/store/kennzahlen.js` nicht. An `tools/bereiche.json`, den dependency-cruiser-Regeln und den Altverstößen ändert sich nichts. Aus derselben Regel folgt eine zweite Verschiebung: Der Rollenname steht als Konstante in `src/db/migrate.js`, und `kennzahlen.js` importiert ihn von dort. Umgekehrt verstieße ein Import aus `src/db/` nach `src/store/` ebenfalls gegen `speicher-nur-ueber-fassade` (Ausgangslage). Umkehrbar. Empfehlung: ja.
9. Entschieden von der Betreuung am 03.11. (Freigabe von Design Doc und Sicherheitsprüfung): Fassade `src/store.js` mit `starteKennzahlenLauf`, `kennzahlenTakt`, `kennzahlenMomentaufnahme`; die Rollenkonstante `kennzahlen_leser` steht exportiert in `src/db/migrate.js` statt in `kennzahlen.js`, weil sonst ein neuer Verstoß gegen `speicher-nur-ueber-fassade` entstünde. `src/store.js` steht in der Dateiliste des Pitches. Der Lauf startet in Teil t1-t1-t1 nur mit `STORE_BACKEND=pg`, gesetzter `KENNZAHLEN_DATABASE_URL` und vorhandener Rolle (ohne OTLP-Adresse als Bedingung, nur Hinweis für diesen Teil); die Kopplung an die OTLP-Adresse stellt der spätere Teil mit der B3-Verdrahtung wieder her, Pitch und Design bleiben.
10. Testaufbau (Betreuung 03.11., G9/G10; berichtigt nach der Prüfung des Plans, weil die Testhilfe das meiste schon kann): Tests laufen über den Hermes-Start (ein Start je Testprozess).
    - Die Testhilfe `test/abrechnung/server-mit-testdatenbank.js` hat schon `zusatzRollen`, `appRolleDatenbankAnlegen`, `appRolleVerwaltetZusatzRollen`, `clientBruecke` und `schemaErneutAnwenden`, und diese Teile werden benutzt und nicht neu gebaut.
    - Neu sind nur fünf Teile, und die alten Aufrufe behalten ihren Standard.
    - Die Option `appRolleErstelltRollen` gibt der App-Rolle `CREATEROLE`.
    - Die Option `kennzahlenAdresse` setzt `KENNZAHLEN_DATABASE_URL` vor dem Import von `src/store.js`.
    - Die Option `unterKennzahlenLeser` lässt die Brücke jede Abfrage des Lauf-Clients in `db.transaction` mit `SET LOCAL ROLE kennzahlen_leser` ausführen, damit keine Abfrage des Pools dazwischenkommt.
    - Die Option `ohneStartanruf` lässt in `unbelegtenAnrufAnlegen` nur den Anruf weg und lässt die aktive Nummer bestehen.
    - Das Rückgabefeld `laufClients` gibt die Liste aus `clientAufPglite` heraus.
    - Jedes Szenario „meldet keinen Messwert“ hat eine Gegenprobe im selben Aufbau.

## Ausgangslage und Annahmen
| Aussage | Beleg | Wenn sie nicht stimmt |
|---|---|---|
| Vorhandene Hilfe: „höchstens ein Lauf zugleich“ (`makeKeyedSingleFlight`), Rollenprüfung als Vorbild, PGlite-Rolle ohne Superuser für Tests, `pg` als Abhängigkeit. Für OTLP/Messwerte gibt es nichts. | `src/single-flight.js:10-20`; `src/portal-pool.js:6-36`; `test/pg-helpers.js:30-38`; `package.json:64`; Suche nach `otlp`, `opentelemetry`, `kennzahlen` in `src/`: 0 Treffer | – |
| `applySchema` führt jede eingetragene Migration bei jedem Aufruf mit einem einzigen `exec` aus. Heute steht dort nur `0001_ausgang.sql`. | `src/db/migrate.js:9-11,21-23` | – |
| `migrate` ruft `applySchema` bei jedem Start auf (`store.init` → `prepareSchema = migrate`). Scheitert das, beendet sich der Prozess. | `src/db/migrate.js:177-184`; `src/store/pg.js:22,32-35`; `src/store.js:7-14,21-31` | – |
| Die Migration läuft über den gemeinsamen Pool mit `DATABASE_URL`. `exec` ist dort ein `client.query(sql)` ohne Parameter, der Client geht danach in den Pool zurück. | `src/store/pg-runner.js:1-16`; `src/config.js:616` | – |
| Mehrere Anweisungen in einer einfachen Query laufen als eine implizite Transaktion: Ein Fehler rollt alle zurück, und der Rest wird nicht ausgeführt. | https://www.postgresql.org/docs/current/protocol-flow.html (Multiple Statements in a Simple Query) | – |
| `SET LOCAL` gilt nur bis zum Ende der Transaktion. In der impliziten Transaktion zählt die Sitzung als Transaktionsblock (`IsTransactionBlock` ist nur für `TBLOCK_DEFAULT` und `TBLOCK_STARTED` falsch). | https://www.postgresql.org/docs/current/sql-set.html; https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/access/transam/xact.c | Die Zeitgrenze wirkt nicht; S27 wird rot. |
| PGlite `exec` nutzt das einfache Query-Protokoll und führt mehrere Anweisungen aus. | https://pglite.dev/docs/api | – |
| Alle Migrationen zusammen bilden heute je eine eigene Transaktion. Die Prüfzwecke gehen von „genau einmal und in eigener Transaktion“ aus; der Code führt sie bei jedem Start aus. | `tools/auftrag/zweck.json:177-183`; `src/db/migrate.js:21-23` | – |
| `0001` ist bei jedem Lauf wiederholbar und nimmt bei jedem Start Sperren auf `tenant`, `account` und `call`: `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, `ENABLE`/`FORCE ROW LEVEL SECURITY`, `DROP`/`CREATE POLICY`. | `src/db/migrations/0001_ausgang.sql:1-2,19,1054-1055,1101-1104` | – |
| `ACCESS SHARE` (jedes `SELECT`) kollidiert nur mit `ACCESS EXCLUSIVE`; viele Formen von `ALTER TABLE` nehmen `ACCESS EXCLUSIVE`. `lock_timeout` gilt für jeden einzelnen Sperrversuch und ist nur unterhalb von `statement_timeout` wirksam. | https://www.postgresql.org/docs/current/explicit-locking.html; https://www.postgresql.org/docs/current/runtime-config-client.html | – |
| `lock_timeout`, `statement_timeout` und `idle_in_transaction_session_timeout` setzt jede Rolle für ihre eigene Sitzung selbst. | https://www.postgresql.org/docs/current/runtime-config-client.html | – |
| Die Migrationsprüfung verlangt neue Migrationen unter `src/db/migrations/NNNN_name.sql` mit höherer Nummer. Sie lehnt DDL-Zeilen in JS unter `src/` und `scripts/` ab, ebenso `squawk-ignore` und Änderungen an gemergten Migrationen. Squawk prüft jede neue Migration. | `tools/migrationen-pruefen.mjs:16,20-23,99-117,119-126,140-173,222-232`; `tools/migrationen-orte.mjs:1-2` | – |
| Die Squawk-Einstellung setzt nur `pg_version = "16.0"` und `assume_in_transaction = true`, keine zusätzlichen Regeln. | `tools/basis/squawk.toml:1-2` | – |
| Die Prüfzwecke verlangen in jeder neuen Migration `SET LOCAL lock_timeout` und `SET LOCAL statement_timeout`. Nicht angenommen werden eine Schemaänderung in dynamischem SQL (`EXECUTE`) und eine Zeitgrenze, die nichts begrenzt. | `tools/auftrag/zweck.json:179-181` | – |
| Squawk hat Regeln für Zeitgrenzen (`require-lock-timeout`, `require-statement-timeout`; Werte am Anfang der Datei). `ban-create-policy`, `ban-drop-policy`, `ban-revoke` und `ban-replace-view-function` muss man ausdrücklich einschalten. Ob Squawk den Inhalt eines `DO`-Blocks prüft, sagt die Doku nicht. | https://squawkhq.com/docs/rules; https://squawkhq.com/docs/require-timeout-settings; https://squawkhq.com/docs/ban-create-policy; https://squawkhq.com/docs/ban-drop-policy; https://squawkhq.com/docs/ban-revoke; https://squawkhq.com/docs/ban-replace-view-function; https://squawkhq.com/docs/cli | – |
| Squawk 2.68.0 nimmt `SET LOCAL` als Zeitgrenze an, und keine Standardregel greift bei `CREATE SCHEMA IF NOT EXISTS`, `CREATE OR REPLACE VIEW`, `DROP POLICY IF EXISTS`/`CREATE POLICY`, `GRANT` und `REVOKE`. | ungeprüft; prüfen durch: `node tools/migrationen-pruefen.mjs --basis <Basis>` im Bau | Der Bau steigt mit dem Ausweg aus `zweck.json` („Auftrag passt nicht …“) aus, statt die Prüfung zu umgehen. |
| `CREATE SCHEMA IF NOT EXISTS` prüft das Recht `CREATE` auf der Datenbank vor der Frage, ob das Schema existiert. Bei jedem Start ohne dieses Recht scheitert es also auch bei vorhandenem Schema. | https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/commands/schemacmds.c | – |
| `CREATE POLICY` darf nur der Eigentümer der Tabelle. Erlaubende Regeln gelten mit ODER. Bei einer Sicht ohne `security_invoker` gelten die Regeln, die für den Eigentümer der Sicht gelten. | https://www.postgresql.org/docs/current/sql-createpolicy.html | – |
| `CURRENT_USER` in einer Sicht liefert immer den Aufrufer. `CREATE OR REPLACE VIEW` verlangt Eigentum und dieselben Spalten. Bei `security_invoker` braucht der Aufrufer Rechte auf die Basistabellen. | https://www.postgresql.org/docs/current/sql-createview.html | S13 wird rot. |
| `call` hat `FORCE ROW LEVEL SECURITY` und die Regel `tenant_isolation`. `tenant` und `account` haben keinen Zeilenschutz. | `src/db/migrations/0001_ausgang.sql:13-17,985-991,1054-1055,1101-1104` | – |
| Die App-Rolle ist weder Superuser noch `BYPASSRLS`, sonst bricht der Start ab. `DATABASE_URL` ist der Internal Connection String. | `src/portal-pool.js:6-36` (aufgerufen über `src/wiring/web-login.js:100`, Import `src/app.js:44`); `docs/RUNBOOK-RESTORE.md:19,22-23,87` | – |
| Die Test-Einrichtung „Rolle ohne Superuser“ hat nur `CREATE` auf dem Schema `public`, nicht auf der Datenbank, und auf ihr laufen bestehende Tests mit `migrate`. | `test/pg-helpers.js:30-38`; `test/store-pg-rls.test.js:261-274` | – |
| Render hat keinen Pre-Deploy-Befehl in der Blueprint. Gestartet wird mit `npm start`, Plan `free`, eine Instanz, Gesundheitsprüfung `/healthz`. | `render.yaml:6-9` | – |
| Beim Deploy bekommt die alte Instanz weiter allen Verkehr, bis die neue läuft; scheitert der Start, scheitert der Deploy, und der letzte erfolgreiche Stand läuft weiter. SIGTERM folgt etwa 60 s nach dem Umschalten. Pre-Deploy-Befehle gibt es nur für bezahlte Dienste. | https://render.com/docs/deploys | – |
| Free-Dienste schlafen nach 15 Minuten ohne Verkehr, starten bei der nächsten Anfrage neu, und Render kann sie jederzeit neu starten. Free-Postgres hat kein Pooling. | https://render.com/docs/free | – |
| Ein Rollback übernimmt die Einstellungen und Umgebungsvariablen des Ziel-Deploys. | https://render.com/docs/rollbacks | – |
| Render-PgBouncer arbeitet nur im Transaktionsmodus. Sitzungssperren brauchen die direkte Verbindung, und die Standard-Adressen gehen direkt auf Postgres. | https://render.com/docs/postgresql-connection-pooling | – |
| Sitzungssperren halten bis zum Freigeben oder bis zum Ende der Sitzung. `pg_try_advisory_lock` wartet nicht. Ein 64-Bit-Schlüssel und ein Schlüsselpaar überschneiden sich nicht. | https://www.postgresql.org/docs/current/functions-admin.html | – |
| Die App nutzt Sitzungssperren heute nur transaktionsweit mit einem Schlüssel (`pg_advisory_xact_lock(hashtext(…))`). | `src/web-auth.js:289` | – |
| `pg.Client` kennt die Optionen `statement_timeout` und `query_timeout`. An einen Client im Leerlauf gehört ein `error`-Listener. | https://node-postgres.com/apis/client | – |
| Ein `uncaughtException` setzt einen Schaden, der nie gelöscht wird; `/healthz` meldet ihn dann dauerhaft mit 503. Ein Pool-Stau ab 300 s meldet ebenfalls 503. | `src/process-guards.js:16-19`; `src/utils/lokale-gesundheit.js:5-13`; `src/utils/healthz-route.js:18,39-49` | – |
| `started_at` steht immer als `toISOString()` (UTC mit `Z`) in der Tabelle. `answered_at` und `ended_at` setzen Aufrufer mit eigenem Zeitwert. | `src/store/state-ops.js:293,408-443`; `src/db/migrations/0001_ausgang.sql:233-241` | – |
| `objective_achieved` ist Text (`true`, `false`, `unclear` oder leer), `consults` eine JSON-Liste am Anruf, `estimated_cost_cents` der gebuchte Betrag in Cent. | `src/store/pg.js:1880-1889`; `src/claude.js:749`; `src/store/state-ops.js:301,747`; `src/db/migrations/0001_ausgang.sql:243,287-302,342` | – |
| `invoice.payment_failed` suspendiert den Mandanten. Abo-Felder: `stripe_subscription_id`, `stripe_plan_slug`, `stripe_billing_hold`. Plan-Slugs: `starter`, `business`. | `src/billing/webhook.js:114-121,145-146`; `src/db/migrations/0001_ausgang.sql:48-49,103`; `src/plans.js:3,19` | – |
| `account.created_at` ist `TIMESTAMPTZ DEFAULT now()`. Die Kontoanlage setzt es nicht selbst. Das Speicherabbild kennt aus `account` nur `sub` und `tenant_id`. | `src/db/migrations/0001_ausgang.sql:985-991`; `src/web-auth.js:336-341`; `src/store/pg.js:737-738` | – |
| Ein Flush schreibt in einer Transaktion. | `src/store/pg.js:1206-1226` | – |
| Außerhalb von `src/store/` und `src/store.js` darf keine Datei unter `src/` aus `src/store/` importieren (Regel `speicher-nur-ueber-fassade`), auch `src/boot.js` und `src/db/migrate.js` nicht. Ihre heutigen Importe von dort sind eingefrorene Altverstöße, und die Liste darf nur kürzer werden. Im Baustein `speicher` ist `src/store.js` ein Eingang. | `.dependency-cruiser.cjs:34-40`; `src/boot.js:40,45-52,54-59`; `src/db/migrate.js:4`; `.dependency-cruiser-known-violations.json:1575,1589,1603,1715`; `tools/abhaengigkeiten.mjs:101,108`; `tools/bausteine.json:66-84` | – |
| Ein Test darf aus `src/` nur die Eingänge und die Fachlogik aus `tools/bereiche.json` importieren. Dazu gehört `src/store.js`, nicht `src/store/kennzahlen.js`. Tests starten Hermes im Prozess, indem sie zuerst `src/store.js` und dann `src/server.js` importieren. Beide nutzen dieselbe Fassade. | `.dependency-cruiser.cjs:18-21,51-57`; `tools/bereiche.json:101`; `test/abrechnung/server-mit-testdatenbank.js:147,180` | – |
| `bootServer` bekommt die Fassade `src/store.js` als `store`. | `src/server.js:3,208-210,239`; `src/boot.js:692-695` | – |
| Die Fassade bietet Funktionen auf drei Wegen an: als Methoden des Speichers (`export const { … } = backend`), als an `load()`/`save()` gebundene reine Funktionen über `mitZustandsFunktionen`/`zustandsFunktionen` und als Weiterreichung aus einer Datei unter `src/store/` (`classifyCallTime`, `zustandsFunktionen`, `MAX_CALL_DURATION_CAP_S`). | `src/store.js:16-18,36-190,196-198`; `src/store/zustand/anbindung.js:4-15` | – |
| Jeder Zugriff `store.<name>` in `src/` muss ein Export von `src/store.js` sein (ESLint-Regel `hermes/speicher-fassade`). Eine Weiterreichung mit `export { … } from` gilt als Export. | `eslint.config.js:177-180,243-247`; `tools/eslint-rules/index.js:471-511`; `test/werkzeuge/speicher-fassade-regel.test.js:17-26,76-97` | – |
| Weder `src/store.js` noch `src/db/migrate.js` gehören zu den Sammeldateien, die keinen neuen Export bekommen dürfen. | `tools/abhaengigkeiten/sammeldatei-exporte.mjs:8,93-108`; `tools/basis/sammeldatei-exporte.json` (kein Eintrag für die beiden Dateien); `tools/zweck/basis.json:60` | – |
| Die Log-Maske merkt sich Werte nur über den Namen (`…KEY`, `…TOKEN`, …) und erst ab 16 Zeichen. Sie ersetzt nur die Rohform. | `src/log-maske.js:5-6,14-21,23-27` | – |
| `docs/sicherheitsgrenzen.md` führt bis SG-25. | `docs/sicherheitsgrenzen.md:39` | – |
| PGlite hat nur eine Sitzung. | `docs/RELEASE-GATE-killer-test.md:3-4` | – |
| `pg_input_is_valid(text, typ)` prüft Eingaben ohne Abbruch (ab Postgres 16). | https://www.postgresql.org/docs/current/functions-info.html | Die Sicht prüft die Zeitform per regulärem Ausdruck. |
| Die App-Rolle hat `CREATEROLE` und `CREATE` auf der Datenbank. | ungeprüft; prüfen durch: als App-Rolle `SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user` und `SELECT has_database_privilege(current_database(), 'CREATE')` | Ohne `CREATEROLE` kann der Betreiber die Rolle nicht anlegen, und es gibt nie Messwerte. Ohne `CREATE` wird die Migration bei jedem Start übersprungen (Logzeile). |
| Produktion läuft mit Postgres 16.14, PGlite 0.5.8 mit Postgres 18.3. | `infrastruktur-audit-20261030` F-28 (Produktion); gemessen mit `SHOW server_version` in PGlite | – |
| B3 bietet einen beobachtbaren Messwert (Wert beim Export abgefragt, ohne Momentaufnahme keine Meldung) und setzt auf diese Messwerte kein Label je Prozess. | ungeprüft; B3 ist nicht gemergt | S12, S14 und S16 brechen; Teil 2 passt den Auftrag an. |
| `KENNZAHLEN_DATABASE_URL` zeigt direkt auf Postgres, nicht auf einen PgBouncer. | ungeprüft; der Betreiber setzt den Internal Connection String | Die Sitzungssperre gilt nicht, und S16 bricht. |
| `pg_try_advisory_lock` darf jede Rolle ausführen, auch `kennzahlen_leser`. | ungeprüft; prüfen durch: S16 im Test | Der Lauf meldet nie; das Log zeigt den Rechtefehler. |

## Was die Wahl bestimmt
- S13 und die Falle „Sicht der App-Rolle zählt 0“: Unter `FORCE` sieht der Eigentümer der Sicht nur Zeilen, die eine Regel für ihn freigibt. Zu entscheiden ist, wem die Sicht gehört und welche Regel sie freigibt.
- Absicht des Pitches und S22: Die Leserolle darf nur das Schema `kennzahlen` lesen, nie `call` selbst.
- B3 und PM1, für den Migrationsweg neu begründet: Die Migration läuft heute bei jedem Start im Startpfad (`src/db/migrate.js:177-184`, `src/store/pg.js:32-35`), und jeder Fehler beendet den Prozess (`src/store.js:21-31`). Bei einem Deploy fiele das nur als gescheiterter Deploy auf (Render-Doku Deploys). Render startet den Free-Dienst aber auch nach jedem Einschlafen und jederzeit neu (Render-Doku Free). Fehlt der App-Rolle danach ein Recht, etwa nach einer Wiederherstellung auf eine neue Instanz (`docs/RUNBOOK-RESTORE.md:87`), käme Hermes bei keinem Start mehr hoch. `CREATE SCHEMA IF NOT EXISTS` prüft das Recht bei jedem Lauf (Postgres-Quelltext). Unter „genau einmal“ gilt dasselbe, solange die Migration nicht erfolgreich war. Die Pflicht „Start scheitert nicht an fehlender Rolle oder fehlendem Recht“ gilt also unter beiden Annahmen; belegt wird sie durch B3 und das vorgeschlagene B5.
- S27: Eine offene Transaktion von `kennzahlen_leser` hält `ACCESS SHARE` auf `call`, `tenant` und `account`. `0001` braucht bei jedem Start stärkere Sperren auf genau diesen Tabellen (`src/db/migrations/0001_ausgang.sql:19,1054-1055,1101-1104`). `0001` darf sich nicht mehr ändern (`tools/migrationen-pruefen.mjs:140-153`), also muss die Zeitgrenze von außen kommen.
- Beide Annahmen (jeder Start, genau einmal): Ein Teil, der nur bei jedem Start hält, etwa ein Überspringen, das als „erledigt“ zählt, versagt unter „genau einmal“.
- Randbedingung: Squawk muss jede Schemaänderung sehen. Eine Schemaänderung in einer Form, die die Prüfung nicht sieht, ist eine Lockerung (`CLAUDE.md`, „Keine Umgehung von Prüfungen“). Ob Squawk `DO`-Körper prüft, ist undokumentiert.
- S16: Beim Deploy laufen zwei Prozesse rund 60 s gleichzeitig (Render-Doku Deploys); genau einer meldet.
- S12, S15 und B2: Die Abfrage der Sicht läuft über höchstens eine eigene Verbindung mit einer Frist, die auch auf dem Server abbricht, nie über den gemeinsamen Pool. Nur die Frage, ob die Rolle existiert, geht als App-Rolle über den gemeinsamen Pool; sie liest nur den Katalog `pg_roles`.
- S14, S8 und PM13: festes Raster; „heute“ unabhängig von der Zeitzone der Sitzung; eine unlesbare Zeit bricht die Sicht nicht ab.

## Lösung
Beteiligt sind:
- `src/db/migrations/0002_kennzahlen.sql`: Schema, Sicht, Regel, Rechte. Die Nummer vergibt der Bau; kommt K2 zuerst, wird es `0003`.
- `src/db/migrate.js`: Eintrag, Bedingung, Zeitgrenze und der Rollenname `kennzahlen_leser` als eine exportierte Konstante.
- `src/store/kennzahlen.js`: Lauf, Minutentakt, eigene Verbindung, Momentaufnahme. Den Rollennamen importiert er aus `src/db/migrate.js`. Diese Richtung ist erlaubt, wie bei `src/store/pg.js:13`; umgekehrt wäre es ein neuer Verstoß gegen `speicher-nur-ueber-fassade`.
- `src/store.js`: reicht `kennzahlenTakt` und `kennzahlenMomentaufnahme` aus `kennzahlen.js` weiter. `starteKennzahlenLauf` ist dort eine kleine Funktion, die `backend.rolleVorhanden` an den Start in `kennzahlen.js` übergibt; die Methode `rolleVorhanden` liegt in `createPgBackend`, das Backend für Dateien liefert `false`.
- `src/boot.js`: ruft `store.starteKennzahlenLauf()` und übergibt `store.kennzahlenMomentaufnahme` an B3.
- `src/config.js`, `.env.example`, `render.yaml`: Schlüssel `KENNZAHLEN_DATABASE_URL` im Namensraum `store` (`src/config.js:907`).
- `src/log-maske.js`: S28, S29.
- `docs/sicherheitsgrenzen.md`: SG-26.

Außer Postgres und dem B3-Export ist kein Anbieter berührt.

**Migration (`0002_kennzahlen.sql`, alle Anweisungen auf oberster Ebene, kein `DO`-Block, kein `EXECUTE`):**
1. `SET LOCAL lock_timeout` (5 s) und `SET LOCAL statement_timeout` (10 s) am Anfang. Das verlangen die Prüfzwecke; die Werte enden mit der Transaktion der Migration.
2. `CREATE SCHEMA IF NOT EXISTS kennzahlen`.
3. `CREATE OR REPLACE VIEW kennzahlen.messwerte` in Langform. Die Spalten heißen `messwert` (Text), `richtung`, `ergebnis`, `ziel`, `plan` (alle Text; leerer Text, wo der Messwert das Label nicht hat) und `wert` (`bigint`). Das sind die gemeinsamen Namen der Migration (u3) und des Takts (a1). Sie liefert ein festes Raster aller 25 Kombinationen und füllt fehlende Kombinationen mit 0. Jede Labelausprägung stammt aus einer festen Liste in der Sicht, nie aus einem Tabellenwert (S9, S10, S14). Das Raster:
   - `anrufe_heute`: `richtung` `inbound`, `outbound` mal `ergebnis` `angenommen`, `nicht_angenommen`, `besetzt`, `fehlgeschlagen`, `laufend`, `sonstige` (12 Zeilen);
   - `zielerreichung_heute`: `ziel` `erreicht`, `nicht_erreicht`, `unbekannt` (3 Zeilen);
   - `gespraechsdauer_sekunden_heute` und `beantwortete_anrufe_heute`: je `richtung` `inbound`, `outbound` (2 + 2 Zeilen);
   - `rueckfragen_heute` und `anmeldungen_heute`: je 1 Zeile ohne Label;
   - `abos`: `plan` `starter`, `business` (2 Zeilen);
   - `kosten_heute_cent`: `richtung` `inbound`, `outbound` (2 Zeilen).
4. `DROP POLICY IF EXISTS kennzahlen_lesen ON call`, dann `CREATE POLICY kennzahlen_lesen ON call FOR SELECT USING (current_user = 'kennzahlen_leser')`, nach dem Muster von `0001:1101-1104`.
   - Die Sicht gehört der App-Rolle, also gelten deren Regeln mit ODER: `tenant_isolation` oder `kennzahlen_lesen`. `current_user` ist dabei der Aufrufer.
   - Für Sitzungen der App ist die neue Bedingung immer falsch, für sie ändert sich nichts.
   - Für `kennzahlen_leser` sind über die Sicht alle Zeilen sichtbar (S13). Direkt auf `call` kommt die Rolle nicht, weil sie dort kein Recht hat.
5. `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM kennzahlen_leser` (S22), `GRANT USAGE ON SCHEMA kennzahlen` und `GRANT SELECT ON kennzahlen.messwerte` an `kennzahlen_leser`.
6. `ALTER ROLE kennzahlen_leser CONNECTION LIMIT 2` (T3, S25). Die Anweisung `ALTER ROLE kennzahlen_leser CONNECTION LIMIT 2` bleibt in der Migration, sie wird weder still weggelassen noch umgeformt, auch nicht, wenn die Migrationsprüfung sie ablehnt. Eine gewöhnliche Rolle kann ihre eigene Grenze nicht ändern; die App-Rolle darf es als Anlegerin der Rolle (PG16: `ADMIN OPTION`). Fehlt ihr das Recht, ergibt das `42501`, und die Migration wird übersprungen (B5). Die Migrationsprüfung (Squawk, `tools/migrationen-pruefen.mjs`) wird beim Bau gegen die Anweisung geprüft; nimmt sie sie nicht an, steigt der Bau mit dem Ausweg aus `tools/auftrag/zweck.json` aus, und T3 gilt als „erkennen“ (Rollenprüfung des Laufs, S25), nicht als „verhindern“.

Jede Anweisung lässt sich wiederholen: unter „jeder Start“ läuft die Datei bei jedem Start, unter „genau einmal“ einmal. Weil die Datei als eine implizite Transaktion läuft, gilt sie ganz oder gar nicht.

**Start (`src/db/migrate.js`, `applySchema`):**
1. Vor dem Text jeder Migration steht `SET LOCAL lock_timeout` (5 s) im selben `exec`. So wartet auch `0001` nicht länger auf eine Sperre (S27). Der Wert endet mit der Transaktion und geht nicht mit dem Client in den Pool zurück. `statement_timeout` setzt `migrate.js` nicht, weil kein Szenario es für `0001` verlangt.
2. Die Kennzahlen-Migration läuft nur, wenn `pg_roles` die Rolle `kennzahlen_leser` enthält. Sonst gibt es eine Logzeile `[migrate] kennzahlen übersprungen: Rolle fehlt` (B3).
3. Scheitert sie mit SQLSTATE `42501` (fehlendes Recht, etwa `CREATE` auf der Datenbank oder Eigentum an `call`), ist sie ganz zurückgerollt. Es gibt eine Logzeile mit der Fehlermeldung, und der Start läuft weiter (B5). Jeder andere Fehler bricht den Start ab wie heute; so fällt ein Fehler in der Sicht in den Tests von S1 bis S19 auf.
4. Wer später einen Lauf „genau einmal“ baut, darf eine übersprungene Kennzahlen-Migration nicht als erledigt vermerken. Dann holt der nächste Start sie nach, sobald Rolle und Rechte da sind, ohne dass der Betreiber Rechte von Hand vergibt.
5. Zuschnitt dieses Teils (t1-t1-t1): `applySchema` baut hier nur Punkt 2. Punkt 3 (Überspringen bei `42501`) kommt mit B5 und B6 in den Teil t4, Punkt 1 (`lock_timeout` vor jeder Migration) mit S27 ebenfalls dorthin. Bis dahin gibt es in Produktion keine Rolle `kennzahlen_leser`, die Migration läuft dort also nicht.

**Regeln in der Sicht.** „Heute“ heißt: Die ersten 10 Zeichen von `started_at` sind gleich `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')`. Das ist ein Textvergleich ohne Cast (S8, S18).
- `ergebnis`:
  - beantwortet und beendet → `angenommen`, auch mit `failure_reason` (S17);
  - beantwortet und nicht beendet → `laufend`;
  - nicht beantwortet mit `no-answer` → `nicht_angenommen`, mit `busy` → `besetzt`, mit `failed` oder `failed:…` → `fehlgeschlagen`;
  - nicht beantwortet, ohne Grund und nicht beendet → `laufend`;
  - alles andere → `sonstige` (S1, S10).

  „Beantwortet“ heißt `answered_at` gesetzt, „beendet“ heißt `ended_at` gesetzt. Andere Werte von `direction` als `inbound` und `outbound` erscheinen in keinem Messwert mit `richtung`.
- `zielerreichung_heute`: nur beendete Anrufe; `true` → `erreicht`, `false` → `nicht_erreicht`, alles andere → `unbekannt` (S2).
- `gespraechsdauer_sekunden_heute` und `beantwortete_anrufe_heute`: zählen dieselben Anrufe, nämlich beantwortete und beendete mit gültigem `answered_at` und `ended_at`. Erst `pg_input_is_valid`, dann der Cast; die Dauer in Sekunden (S3, PM13).
- `rueckfragen_heute`: Länge von `consults`, nur wenn es eine JSON-Liste ist (S4).
- `kosten_heute_cent`: Summe von `estimated_cost_cents`, leer zählt als 0 (S5).
- `anmeldungen_heute`: Mandanten, deren frühestes Konto heute angelegt wurde, gemessen an `(account.created_at AT TIME ZONE 'UTC')::date` (S6).
- `abos`: Mandanten mit `stripe_subscription_id`, `status = 'active'` und ohne `stripe_billing_hold`, gezählt je `stripe_plan_slug` aus `starter`, `business` (S7, S19).

**Lauf (`src/store/kennzahlen.js`, erreichbar nur über die Fassade `src/store.js`):**
`src/store.js` bietet drei Funktionen an. Zwei reicht es aus `kennzahlen.js` weiter, so wie heute `classifyCallTime` und `MAX_CALL_DURATION_CAP_S`; die dritte ist eine kleine Funktion in `src/store.js` selbst:
- `starteKennzahlenLauf()` ruft den Start in `kennzahlen.js` mit `backend.rolleVorhanden`. `kennzahlen.js` importiert `src/store.js` nicht, denn `src/store.js` reicht aus `kennzahlen.js` weiter, ein Import zurück wäre ein Ordnerkreis, den `.dependency-cruiser.cjs:44-49` verbietet. Der Start startet den Minutentakt, einen Zeitgeber mit `unref` wie `src/boot.js:728-731`. Er ruft je Minute `rolleVorhanden` mit dem Rollennamen und, wenn die Rolle da ist, `kennzahlenTakt` auf. Fehlt die Rolle oder scheitert die Frage (Frist 5 s im Prozess), löscht er die Momentaufnahme, schließt einen offenen eigenen Client hart und wartet auf den nächsten Takt. Die Adresse liest `kennzahlen.js` aus `config.store`, so wie `src/store.js:10` die Adresse des Pools.
- `rolleVorhanden(rolle)` ist eine Methode des Speichers in `createPgBackend`. Sie fragt `pg_roles` mit `client.query(text, [rolle])` über den gemeinsamen Pool, also als App-Rolle, und liest nur den Katalog. Das gibt es schon in `src/store/pg-runner.js:10` und liefert in Produktion und im Test dieselbe Form. Eine Katalogabfrage hält keine Sperre auf `call`; die Frist von 5 s bleibt deshalb im Prozess.
- `kennzahlenTakt()` führt einen Takt aus (Ablauf unten). Läuft schon einer, bekommt der Aufrufer dessen Ergebnis (`src/single-flight.js:12-15`).
- `kennzahlenMomentaufnahme()` liefert die letzte Momentaufnahme oder keine.

Die drei gehen nicht über `mitZustandsFunktionen` (`src/store.js:16-18`). `zustandsFunktionen` bindet reine Funktionen an `load()` und `save()` des Speichers (`src/store/zustand/anbindung.js:4-15`), der Lauf nutzt aber den Zustand nicht, und seine Abfrage der Sicht geht nie über den gemeinsamen Pool. Nur die Methode `rolleVorhanden` nutzt den Pool, weil sie als App-Rolle nur den Katalog liest. Die Fassade bietet die drei unabhängig von `STORE_BACKEND` an; beim Dateispeicher ruft sie niemand (B4), und `rolleVorhanden` liefert dort `false`.

Aufrufer ist nur `src/boot.js`. `bootServer` bekommt die Fassade als `store` (`src/server.js:3,208-210,239`; `src/boot.js:692-695`). Nach dem Takt in `src/boot.js:728-731` ruft `boot.js` `store.starteKennzahlenLauf()` auf, aber nur, wenn alle drei Bedingungen gelten: `STORE_BACKEND=pg`, eine OTLP-Adresse aus B3 und ein gesetztes `KENNZAHLEN_DATABASE_URL` (B4). `boot.js` übergibt `store.kennzahlenMomentaufnahme` an B3. `kennzahlen.js` importiert B3 nicht, weil `speicher` nur `basis`, `konfiguration`, `texte`, `mail` und `sperrdaten` nutzen darf (`src/store/CLAUDE.md`). Tests erreichen alle drei über `src/store.js` nach dem Hermes-Start, wie `test/abrechnung/server-mit-testdatenbank.js:147,180`. Den Lauf startet dabei der Start selbst, den Takt löst der Test mit `kennzahlenTakt` aus, und gelesen wird über B3 oder `kennzahlenMomentaufnahme`.

Ablauf eines Takts, einmal je Minute, nie zwei zugleich (`makeKeyedSingleFlight` mit festem Schlüssel):
1. Gibt es keine Verbindung, öffnet der Lauf einen eigenen `pg.Client` auf `KENNZAHLEN_DATABASE_URL` mit `statement_timeout` 5 s und hängt sofort einen `error`-Listener an. Der Listener verwirft die Verbindung und löscht die Momentaufnahme (S21).
2. Vor jeder Abfrage der Sicht prüft der Lauf seine Rolle (Vorbild `src/portal-pool.js:6-36`):
   - kein Superuser, kein `BYPASSRLS`, kein `CREATEROLE`, kein `CREATEDB`, keine Replikation;
   - Verbindungsgrenze zwischen 1 und 2;
   - kein Recht auf eine Relation außerhalb von `kennzahlen`;
   - kein `CREATE` auf `public`;
   - keine Mitgliedschaft in einer anderen Rolle.

   Verletzt eine Bedingung, löscht der Lauf die Momentaufnahme, schreibt eine Logzeile `[kennzahlen]` und meldet nichts (S20, S23 bis S26).
3. Ist der Prozess noch nicht Melder, versucht er einmal `pg_try_advisory_lock` mit einem festen Schlüsselpaar; Schlüsselpaare überschneiden sich nicht mit dem `hashtext`-Schlüssel aus `src/web-auth.js:289`. Bekommt er die Sperre nicht, löscht er die Momentaufnahme, und der Takt endet (S16).
4. Er liest `kennzahlen.messwerte` mit einer Abfrage, also aus einem Datenstand; die Zeilen werden die Momentaufnahme.
5. Für den ganzen Takt gilt im Prozess eine Frist von 5 s. Läuft sie ab oder scheitert ein Schritt, löscht der Lauf die Momentaufnahme, schließt die Verbindung, ohne auf ein sauberes Ende zu warten, schreibt eine Logzeile und wartet auf den nächsten Takt (S11, S12, S15). `statement_timeout` beendet die Abfrage auch auf dem Server, damit sie keine Sperre auf `call` hält.
6. B3 liest die Momentaufnahme beim Export über `kennzahlenMomentaufnahme`, die `boot.js` übergeben hat. Ohne Momentaufnahme meldet B3 diese acht Messwerte nicht. Der Lauf legt die acht Namen und ihre Labelnamen bei B3 an; die Labelwerte kommen aus der Sicht.

**Log-Maske:** `src/log-maske.js` merkt sich zusätzlich das Passwort aus `KENNZAHLEN_DATABASE_URL`, roh (prozentkodiert) und dekodiert, ohne Mindestlänge (S28, S29).

Neue Daten: keine Zeilen. Neu sind ein Schema, eine Sicht, eine Regel auf `call`, Rechte, die Rolle `kennzahlen_leser` (vom Betreiber angelegt) und eine Sitzungssperre ohne gespeicherten Zustand.

Datenfluss und Grenzen für den Sicherheits-Agenten:
- `call`, `tenant` und `account` gehen in die Sicht. Ihr Eigentümer ist die App-Rolle.
- Die Regel `kennzahlen_lesen` gibt alle Mandanten frei, sobald die Sitzung `kennzahlen_leser` ist.
- Von dort laufen die Summen über die eigene Verbindung (Geheimnis `KENNZAHLEN_DATABASE_URL`) in die Momentaufnahme im Prozess, dann an B3, OTLP und Grafana.
- Die Momentaufnahme (nur Summen) kann jedes Modul im Prozess über `src/store.js` lesen, und jedes kann dort einen Takt auslösen. Die Verbindung und ihr Geheimnis bleiben in `src/store/kennzahlen.js`.
- Rechte vergibt nur die Migration unter der App-Rolle, und nur wenn es die Rolle gibt. Der Lauf führt keine DDL aus und schreibt nie.
- Wer `CREATEROLE` hat, also nach Annahme die App-Rolle, kann eine Rolle dieses Namens anlegen und über die Sicht die Summen aller Mandanten lesen, aber keine Einzelzeilen.
- Neu gegenüber dem alten Stand: Sicht und Regel entstehen erst, wenn es die Rolle gibt.

Zuordnung:
- Eingang der Szenarien: „Wenn der Kennzahlen-Lauf … läuft“ → `kennzahlenTakt` über `src/store.js`; „Wenn eine Minute vergeht“ (S16, B4) → Minutentakt aus `starteKennzahlenLauf`, gerufen in `src/boot.js`; jedes „steht auf“ und „meldet“ → `kennzahlenMomentaufnahme`, von `src/boot.js` an B3 übergeben
- S1, S2, S3, S4, S5, S6, S7, S8, S10, S17, S18, S19 → Regeln der Sicht
- S9 → festes Raster und feste Labelnamen
- S13 → Regel `kennzahlen_lesen` und Eigentum der App-Rolle
- S14 → festes Raster mit Nullen
- S11, S12, S15 → Takt mit Frist, hartem Schließen und Laufschutz
- S16 → Sitzungssperre
- S20, S23, S24, S25, S26 → Rollenprüfung im Takt
- S21 → `error`-Listener
- S22 → `REVOKE` und `GRANT` der Migration; S33 → `ALTER ROLE … CONNECTION LIMIT 2` der Migration (Test setzt die Grenze vor dem Start auf „keine“); S25 → `CONNECTION LIMIT 2` der Migration und Rollenprüfung; S30, S31, S32 → Rollenprüfung des Laufs (Spalten- und `PUBLIC`-Rechte, `CREATE` auf Datenbank); B6 → Überspringen nur für die Kennzahlen-Migration
- S27 → `SET LOCAL lock_timeout` vor jeder Migration in `applySchema`
- S28, S29 → Log-Maske
- B1 → Leserolle ohne Schreibrecht, Lauf nur mit `SELECT`
- B2 → eigene Verbindung, Regel nur für `kennzahlen_leser`
- B3 → Bedingung „Rolle existiert“ in `applySchema`
- B4 → `src/boot.js` ruft `store.starteKennzahlenLauf()` nur bei `STORE_BACKEND=pg`
- vorgeschlagenes B5 → Überspringen bei `42501`

### Werkzeugvertrag
Kein Werkzeug ist neu oder geändert, und kein von außen sichtbares Verhalten bestehender Werkzeuge ändert sich. Angesehen:
- `docs/mcp-vertrag.json`: nicht berührt, weil der Lauf keinen Eingang hat;
- `docs/sicherheitsgrenzen.md`, Abschnitt „Angriffsfläche“: keine neue Route, kein Webhook;
- `src/utils/healthz-route.js`: unverändert.

## Fehlerfälle
| Aufruf oder Ereignis | Fehler oder Zeitüberschreitung | doppelt oder andere Reihenfolge | Wiederholung: wo, womit | was der Aufrufer sieht |
|---|---|---|---|---|
| Start: Kennzahlen-Migration, Rolle fehlt | Migration übersprungen, Logzeile | – | nächster Start prüft erneut | Start wie heute; Logzeile `[migrate] kennzahlen übersprungen` |
| Start: Kennzahlen-Migration, `42501` | Implizite Transaktion zurückgerollt, nichts halb angelegt; Logzeile mit Meldung; Start läuft weiter | – | nächster Start; unter „genau einmal“ nicht als erledigt vermerkt | Start wie heute; Lauf liest eine fehlende Sicht und meldet nichts |
| Start: Sperre nicht in 5 s (`55P03`), in `0001` oder der Kennzahlen-Migration | Diese Migration ist zurückgerollt. Der Start bricht ab wie heute bei jedem Migrationsfehler (`src/store.js:21-31`). Die wartende Sperranfrage verschwindet nach höchstens 5 s. | Neue Instanz startet, während die alte liest: Die Abfrage des Laufs endet nach höchstens 5 s (`statement_timeout`), meist nach Millisekunden. Kurz vor einer Kollision liegt der Start fast immer darunter. | Deploy: gescheitert, die alte Instanz läuft weiter (Render-Doku Deploys); erneut deployen. Neustart ohne laufende Instanz: Render startet neu | S27: Start endet nach höchstens 10 s, `/healthz` der laufenden Instanz 200 |
| Start: anderer Fehler der Kennzahlen-Migration (Fehler in der Sicht, Postgres unter 16 ohne `pg_input_is_valid`) | Start bricht ab wie heute | – | keine; Deploy gescheitert, alter Stand läuft weiter | gescheiterter Deploy; fällt vorher in den Tests von S1 bis S19 auf bzw. über die offene Frage zur Version |
| Fassade: `kennzahlenTakt`, während ein Takt läuft (Minutentakt und zweiter Aufruf) | – | Der zweite Aufruf bekommt den laufenden Takt (`src/single-flight.js:12-15`); keine zweite Verbindung, keine zweite Abfrage | keine | Ergebnis des laufenden Takts |
| Postgres: Verbindungsaufbau als `kennzahlen_leser` | Rolle fehlt, Passwort falsch, Datenbank weg: Logzeile (maskiert, S28, S29), keine Momentaufnahme. Hängt der Aufbau: 5-s-Frist, Verbindung verworfen. | – | nur im nächsten Minutentakt; der Laufschutz verhindert einen zweiten Lauf; nur Lesen, keine Kosten | Grafana ohne Daten für die acht Messwerte; Log `[kennzahlen]`; `/healthz` 200 |
| Postgres: Rollenprüfung | zu viele Rechte: keine Momentaufnahme, Logzeile | – | jeder Takt prüft neu | Grafana ohne Daten; Log `[kennzahlen]` zur Rolle |
| Postgres: `pg_try_advisory_lock` | `false`: dieser Prozess meldet nicht | Zwei Prozesse: Postgres vergibt die Sperre genau einmal. Eine getötete alte Instanz hält sie, bis der Server die Sitzung beendet; das ergibt eine Lücke, keine Doppelung. | nächster Takt, einmal je Takt | Grafana: Werte des einen Melders; bei der Übergabe höchstens eine Lücke |
| Postgres: Abfrage `kennzahlen.messwerte` | Fehler (Sicht fehlt, kein Recht): Momentaufnahme gelöscht, Verbindung verworfen, Logzeile. Zeitüberschreitung: Server und Prozess brechen nach 5 s ab. | Eine Abfrage, ein Datenstand; ein gleichzeitiger Flush ist ganz oder gar nicht sichtbar (`src/store/pg.js:1206-1226`) | nächster Takt, neue Verbindung | Grafana ohne Daten bis zum nächsten gelungenen Takt (S11, S12) |
| Postgres: `error`-Ereignis der Verbindung im Leerlauf | Der Listener verwirft die Verbindung und löscht die Momentaufnahme. Ohne Listener würde Node werfen, und `/healthz` bliebe 503. | – | nächster Takt | `/healthz` 200 (S21) |
| B3: Export | durch B15 unverändert; der Lauf wiederholt nichts | – | – | wie B3 |

## Verworfene Wege
- `DO`-Block mit `IF EXISTS` (Rolle) um `GRANT`/`REVOKE` und Überspringen bei `42501` in `migrate.js` (der Weg des alten Stands, Vorbild `0001:662-669`): Die Logik bleibt ganz in SQL, und Schema, Sicht und Regel entstehen schon vor der Rolle. Verworfen wegen der Wahlkriterien „beide Annahmen“ und „Squawk muss sehen“. Unter „genau einmal“ wäre ein Lauf vor dem Anlegen der Rolle endgültig, und der Betreiber müsste die Rechte von Hand vergeben, ohne `REVOKE` (S22). Außerdem ist undokumentiert, ob Squawk `DO`-Körper prüft.
- `DO`-Block mit `EXCEPTION WHEN insufficient_privilege` um alle Kennzahlen-Anweisungen: Die Migration wäre in sich geschlossen, und `migrate.js` bliebe bei einer Zeile. Verworfen, weil Schemaänderungen dann in einer Form stünden, deren Prüfung durch Squawk undokumentiert ist („Keine Umgehung von Prüfungen“). Unter „genau einmal“ zählte ein übersprungener Lauf zudem als erledigt, und es gäbe nie Messwerte.
- Render-Pre-Deploy-Befehl für die Migration („genau einmal je Deploy“, ohne Start-Risiko): Verworfen, weil es ihn nur für bezahlte Dienste gibt und der Dienst auf `plan: free` läuft (`render.yaml:6`; Render-Doku Deploys). Den Startpfad der Migrationen zu ändern, ist zudem nicht Teil des Pitches.
- Eigentümerrolle mit `BYPASSRLS` für die Sicht: Verworfen, weil nur ein Superuser oder eine Rolle mit `BYPASSRLS` sie anlegen kann (https://www.postgresql.org/docs/current/sql-createrole.html) und die App-Rolle das nicht hat (`src/portal-pool.js:29-35`). Außerdem könnte die App-Rolle eine fremde Sicht nicht ersetzen (CREATE-VIEW-Doku: Eigentum nötig).
- Sicht mit `security_invoker` und Regel `TO kennzahlen_leser`: Verworfen, weil die Leserolle dann selbst Rechte auf `call` bräuchte (CREATE-VIEW-Doku) und direkt `tenant_id` und den Wortlaut von `consults` läse, entgegen der Absicht „nur dieses Schema“ (S22).
- Melder über eine Leasing-Zeile statt einer Sitzungssperre: Das ginge auch über PgBouncer. Verworfen, weil die Leserolle dann schreiben müsste (Pitch: „Der Lauf liest nur“) und nach einem Absturz bis zum Ablauf zwei Melder oder keiner möglich wären (S16).
- Summen im Prozess aus dem Speicherabbild: Verworfen, weil die grobe Lösung Sichten vorgibt und `account.created_at` nicht im Abbild liegt (`src/store/pg.js:737-738`).

## Nachteile
- `migrate.js` behandelt die Kennzahlen-Migration als einzige gesondert: Bedingung „Rolle existiert“ und Überspringen bei `42501`. Eine künftige Migration, die diesen Teil ändert, muss dieselbe Bedingung bekommen.
- Der Rollenname `kennzahlen_leser` steht in der Migration (Regel, Rechte) und als eine Konstante in JS. Eine anders benannte Rolle liefert keine Messwerte.
- Mit `lock_timeout` scheitert ein Start an einer Sperre, die länger als 5 s gehalten wird, wo er heute wartet. Das gilt auch für Sperren der App selbst. Beim Deploy bleibt dann der alte Stand. Bei einem Neustart ohne laufende Instanz kommt Hermes erst hoch, wenn die Sperre weg ist, etwa nach Ende einer offenen Transaktion von `kennzahlen_leser`; die setzt ihre Fristen selbst (Doku runtime-config-client).
- Unter „genau einmal“ nimmt nur der Start, der die Migration ausführt, der Rolle die Rechte auf `public`. Danach schützt nur die Rollenprüfung des Laufs (S23), und die meldet nur.
- Die Regel `kennzahlen_lesen` hängt an jede Leseabfrage auf `call` eine ODER-Bedingung. Ob Abfragepläne der App schlechter werden, ist ungeprüft; prüfen mit `EXPLAIN` auf den Lesewegen von `src/store/pg.js`.
- Die Sicht liest jede Minute alle Anrufe der Aufbewahrungsfrist (`RETENTION_DAYS`, `render.yaml:319-320`) ohne Index auf `started_at`.
- Die Sicht hängt an Spalten von `call`, `tenant` und `account`. Postgres verbietet, Objekte mit Abhängigen zu löschen (https://www.postgresql.org/docs/current/ddl-depend.html).
- Ein sehr kurzes Passwort der Leserolle verstümmelt jede Logzeile, die die Zeichenfolge enthält, weil die Maske ohne Mindestlänge ersetzt (S29).
- Anrufe in der letzten Minute vor UTC-Mitternacht können im letzten Tageswert fehlen. Solange der Free-Dienst schläft, meldet niemand, und Grafana zeigt keine Daten statt 0.
- Jede laufende Instanz hält eine zusätzliche Datenbankverbindung, beim Deploy also zwei.

## Übergang, Rückweg und Betrieb
- Für heutige Kunden und fremde Agenten: nichts, weil sich kein Werkzeug, keine Route und keine Antwort ändert und der Lauf nur liest.
- Daten: keine Zeilenänderung.
  - Solange es die Rolle nicht gibt, legt die Migration nichts an.
  - Danach kommen Schema, Sicht, Regel und Rechte dazu. Der alte Code liest sie nicht und läuft weiter, solange beide laufen.
  - Auf `call` kommt eine Regel im selben Muster hinzu, mit dem `0001` `tenant_isolation` bei jedem Start neu anlegt (`0001:1101-1104`). Es entsteht keine neue Sperrart, und dank `lock_timeout` wartet keine Sperranfrage länger als 5 s; laufende Anrufe der alten Instanz warten höchstens so lange.
- Einschalten:
  1. Deploy. Die Migration wird mangels Rolle übersprungen (Logzeile), der Lauf startet nicht.
  2. Der Betreiber legt als App-Rolle über `psql` `kennzahlen_leser` an: Login, `CONNECTION LIMIT 2`, Passwort mit `\password`, ohne weitere Rechte. Die Anleitung steht in `.env.example`.
  3. Er setzt im Render-Dashboard `KENNZAHLEN_DATABASE_URL` (direkte Verbindung) und die OTLP-Adresse aus B3.

  Der nächste Start führt die Migration aus und startet den Lauf, unter beiden Annahmen gleich.
- Rückweg:
  - Sofort und ohne Deploy: `ALTER ROLE kennzahlen_leser NOLOGIN`; danach scheitert der Aufbau jede Minute mit einer Logzeile. `NOLOGIN` beendet offene Sitzungen nicht. Sie beendet die App-Rolle erst, nachdem sie die Zielrolle erben darf (ab PG16 hat sie als Anlegerin nur `ADMIN OPTION`, `INHERIT FALSE`): zuerst `GRANT kennzahlen_leser TO <App-Rolle> WITH INHERIT TRUE`, dann `pg_terminate_backend` auf die Sitzungen der Rolle. Ob die App-Rolle stattdessen `pg_signal_backend` hat, prüft der Betreiber vor dem Einschalten mit `SELECT pg_has_role('pg_signal_backend','USAGE')` (`.env.example` nennt beide Schritte).
  - Dauerhaft: `KENNZAHLEN_DATABASE_URL` entfernen.
  - Code-Rollback: Der alte Code ignoriert Schema, Sicht und Regel, und die Regel greift nur für `kennzahlen_leser`. Er setzt kein `lock_timeout`, damit gilt S27 dann nicht. Render übernimmt die Variablen des Ziel-Deploys (Render-Doku Rollbacks); `KENNZAHLEN_DATABASE_URL` muss beim Wiedereinschalten neu gesetzt werden.
  - Ganz entfernen, von Hand: zuerst die Rolle löschen (vorher ihre Rechte entziehen), dann Regel `kennzahlen_lesen` und Schema `kennzahlen`. Bleibt die Rolle bestehen, legt der neue Code unter „jeder Start“ alles wieder an.
- Laufende Anrufe beim Ausliefern oder Zurückrollen: nicht berührt, weil der Lauf nie schreibt, die Sicht nie über den gemeinsamen Pool liest und die Rollenfrage als App-Rolle nur den Katalog liest. Der Start wartet höchstens 5 s je Sperre und wächst nur um eine Regel auf `call`.
- Woran man im Betrieb sieht, dass es nicht funktioniert:
  - In Grafana fehlen Daten für `anrufe_heute` (keine Nullen).
  - Im Log stehen beim Start `[migrate] kennzahlen übersprungen` (Rolle oder Recht fehlt) und im Takt `[kennzahlen]`-Zeilen (Verbindung, Rolle, Frist).
  - Ein Start, der an `lock_timeout` scheitert, zeigt sich als gescheiterter Deploy mit der Meldung von `src/store.js:25-29`.
- Laufende Kosten: kein neuer bezahlter Dienst. Je Minute und Instanz eine Rollenprüfung und eine Abfrage, je Instanz eine gehaltene Verbindung, 25 feste Serien an Grafana. Ob sie in den Grafana-Plan passen, deckt B3 mit dem Seriendeckel ab.

## Offene Fragen und Rückmeldungen an den Pitch
- Messung vor dem Einschalten (T9, Beschluss 02.11.): Dauer des Flushs `src/store/pg.js:1206-1226` (längste Schreibtransaktion); liegt sie nicht deutlich unter 5 s, wird `lock_timeout` neu bewertet. Vor dem Einschalten außerdem: `\dp` auf `public` (nicht Teil dieser Änderung), Grafana nur Betreiber/EU/AVV (T4).
- Hat die App-Rolle `CREATEROLE` und `CREATE` auf der Datenbank? Offen, siehe „Entscheidungen der Sitzung“. Empfehlung: Antonio führt vor Teil 2 die beiden Abfragen aus der Ausgangslage aus, wie im Pitch vorgesehen. Fehlt `CREATE`, startet Hermes trotzdem, aber es gibt keine Messwerte.
- Postgres-Version von Produktion und PGlite 0.5.8? Geschlossen: Produktion 16.14 (`infrastruktur-audit-20261030` F-28), PGlite 18.3 (gemessen). Die Sicht nutzt `pg_input_is_valid`.
- Werte der Zeitgrenzen? Empfehlung: `lock_timeout` 5 s (`migrate.js` und Migration), `statement_timeout` 10 s nur in der Migration. S27 begrenzt auf 10 s, und `lock_timeout` wirkt nur unter `statement_timeout`.
- Nimmt Squawk 2.68.0 `SET LOCAL` als Zeitgrenze an, und bleibt die Migration ohne Befund? Empfehlung: Der Bau führt `node tools/migrationen-pruefen.mjs --basis …` aus. Bei einem Befund steigt er mit dem Ausweg aus `zweck.json` aus, statt umzuformulieren.
- Bietet B3 einen beobachtbaren Messwert und kein Label `instance` je Prozess? Empfehlung: ja zu beidem. Setzt B3 `service.instance.id`, fasst B12 mit `max` statt `sum` zusammen.
- Rückmeldung zu S22 und der Falle „der Start entzieht ihr bei jedem Lauf alle Rechte auf `public`“: Das gilt, solange `applySchema` jede Migration bei jedem Start ausführt (heute, `src/db/migrate.js:21-23`). Unter „genau einmal“ entzieht nur der Start, der die Migration ausführt. Der Test von S22 ist unter beiden Annahmen grün, weil er auf einer frischen Datenbank startet. Empfehlung: In der Falle „bei jedem Start, an dem die Migration läuft“ schreiben. Den Schutz danach trägt S23.
- Rückmeldung zu S27: „Der Start endet“ heißt hier, er bricht mit Exit ab. Er läuft nicht erfolgreich durch, weil `0001` die Sperre auf `tenant`/`call` nicht bekommt. Empfehlung: „Dann bricht der Start nach höchstens 10 Sekunden ab“.
- Rückmeldung zur Falle „Die Migration darf den Start nie scheitern lassen“: B3 belegt nur „Rolle fehlt“, denn ohne Rolle läuft die Migration gar nicht. Das Überspringen bei fehlendem Recht braucht ein eigenes Szenario (unten).
- Rückmeldung zu den Zeilenbelegen:
  - Die Falle nennt `src/db/migrate.js:20-22`; `applySchema` steht heute in `src/db/migrate.js:21-23`, `migrate` in `:177-184`.
  - `src/boot.js:728-731` und die Belege auf `src/db/migrations/0001_ausgang.sql` stimmen.
  - In Fragerunde S27 gilt dasselbe für `src/db/migrate.js:20-22`.
- Rückmeldung zu „Geänderte Dateien“ (Fassade, Betreuung 02.11.): `src/store.js` fehlt in der Liste. Die Fassade reicht `starteKennzahlenLauf`, `kennzahlenTakt` und `kennzahlenMomentaufnahme` aus `src/store/kennzahlen.js` weiter, weil `src/boot.js` und Tests nicht aus `src/store/` importieren dürfen (`.dependency-cruiser.cjs:34-40,51-57`). Empfehlung: `src/store.js` in „Geänderte Dateien“ aufnehmen. `src/db/migrate.js` steht schon dort; es trägt jetzt zusätzlich die Konstante mit dem Rollennamen.
- Vorgeschlagenes Szenario B5: Start mit Leserolle, aber ohne Recht
  Gegeben eine leere Datenbank, eingerichtet von einer Rolle ohne Superuser, ohne `BYPASSRLS` und ohne das Recht, Schemas in der Datenbank anzulegen, und die Rolle `kennzahlen_leser` existiert
  Wenn Hermes startet
  Dann antwortet `GET /healthz` mit 200
  Und der Kennzahlen-Lauf meldet keinen Messwert

## Entscheidungen der Sitzung

Die Sitzung hat nach P50 selbst entschieden. Eine Bedingung bleibt offen und liegt bei Antonio (erster Punkt). Absicht, Szenarien und Nicht-Ziele sind unverändert.

- OFFEN, bei Antonio vor Teil 2: Die App-Rolle hinter `DATABASE_URL` braucht `CREATEROLE` und `CREATE` auf der Datenbank. Fehlt `CREATEROLE`, gibt es nie Messwerte, und die ganze Migration rollt in Produktion mit `42501` zurück (Probe des Prüf-Agenten in PGlite). Antonio führt als App-Rolle aus: `SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user` und `SELECT has_database_privilege(current_database(), 'CREATE')`. Fehlt `CREATEROLE`, fragt Antonio den Render-Support, bevor Teil 2 startet. Die Sitzung hat die Frage in der Frage-Datei gestellt; ein Ergebnis liegt noch nicht vor. Teil 2 startet erst mit der Antwort.
- Postgres-Version: geschlossen. Produktion 16.14 (`infrastruktur-audit-20261030` F-28), PGlite 0.5.8 mit 18.3 (gemessen mit `SHOW server_version`). Beide kennen `pg_input_is_valid`. Grund: Der Beleg liegt vor, es gibt keine Rückfrage mehr.
- Einstufung und Status: größere Änderung (Design Doc ja); `pitch.md` und `sicherheit.md` stehen auf „Status: freigegeben“. Grund: Die Freigabe von Pitch und Sicherheitsprüfung gab die Betreuung (Teil 1, Antonio 02.11.), weil nichts davon Kunden, Geld oder Recht berührt; die Dokumente blieben nach dem Umschreiben auf den Migrationsweg inhaltlich gleich.
- Schreibort: eine neue Migration `src/db/migrations/0002_kennzahlen.sql` statt `schema.sql`, mit Eintrag in `src/db/migrate.js`. Grund: `schema.sql` nimmt keine Änderungen mehr an; die Nummer vergibt der Bau, weil K2 ebenfalls eine Migration plant.
- S18 (Regel `laufend`): in die eine Migration, kein zweiter Auftrag und keine zweite Datei. Grund: Das Design sieht eine Migration vor, der Teil darf nur `0002_kennzahlen.sql` und `migrate.js` ändern; S18 wird im Auftrag des Takts über den Hermes-Start geprüft (Hinweis 20 im Pitch).
- Abnahme der Migration (u3): der Schematest `test/gemeinsam/schema-erneut-anwendbar-mit-rolle.test.js`, derselbe Test wie bei u2 und u4. Grund: Hinweis 2 und Hinweis 6 verlangen für die Migration einen Test, der sie wirklich ausführt; `test/schema-foundation.test.js` startet ohne die Rolle, überspringt die Migration also. Die frühere Annahme „eine Abnahme gehört nur einem Auftrag“ ist zurückgenommen; `pruefe` lässt dieselbe Abnahme bei mehreren Aufträgen zu (gemessen an einer Kopie der Phase). Der Schematest startet mit der Rolle und `appRolleErstelltRollen` (u2) und führt die Migration damit aus.
- Prüfung von Sicht, Regel `kennzahlen_lesen`, Verbindungsgrenze 2 und zweitem Anwenden der ganz gelaufenen Migration: im neuen Test von a1, wie Hinweis 22b es verlangt. Grund: Ein Umbau ändert keine Testdatei. Damit fällt ein weggelassenes `ALTER ROLE` in a1 auf und nicht erst in t4 (S33). Dass der gemeinsame Pool nach einem Takt weiter als `kv2_app` abfragt, prüft a1 ebenfalls, nach einem Takt.
- Entwurf der Migration: der Weg aus diesem Dokument (Spalten, Raster, Zuordnung von `ergebnis`, „heute“, Regel, Rechte, `ALTER ROLE`) steht jetzt vollständig im Entwurf von u3; die Spaltennamen `messwert`, `richtung`, `ergebnis`, `ziel`, `plan`, `wert` sind gemeinsame Namen von u3 und a1. Grund: Der Bau-Agent bekommt das Design Doc nicht, und u3 darf nach a1 nicht mehr geändert werden; ein Fehler in der Sicht fiele sonst erst in a1 auf. `plan` ist leerer Text statt NULL, `wert` ist `bigint`; das Design ließ beides offen.
- Überspringen bei `42501` in `applySchema` (T8, B5, B6): nicht in diesem Teil, sondern in t4. Grund: In t1-t1-t1 läuft kein Test, der den Zweig erreicht (a1 startet mit allen Rechten, a2 ohne Rolle; B5 und B6 stehen erst in t4), und in Produktion gibt es bis zum Einschalten keine Rolle, die Migration läuft dort nicht. u1 baut nur die Rollenbedingung. `sicherheit.md` hat für T8 keinen Abschnitt in diesem Teil.
- Zeitgrenze `lock_timeout` vor `0001`: nicht in diesem Teil. Grund: Sie ist neues Verhalten bei jedem Start und gehört zu S27 im Teil t4.
- Weg vom Zeitgeber zu `rolleVorhanden`: `starteKennzahlenLauf` ist eine kleine Funktion in `src/store.js`, die `backend.rolleVorhanden` an den Start in `src/store/kennzahlen.js` übergibt; das Backend für Dateien liefert `false`. Grund: `src/store.js` reicht aus `kennzahlen.js` weiter, ein Import zurück wäre ein Ordnerkreis (`.dependency-cruiser.cjs:44-49`).
- `rolleVorhanden` über den gemeinsamen Pool: erlaubt, ausdrücklich nur für diese Frage. Grund: Sie läuft als App-Rolle und liest nur den Katalog `pg_roles`; die Abfrage der Sicht geht weiterhin nie über den Pool. Die Sätze im Design (Ausgangslage, Lauf, Übergang) sind angepasst.
- `rolleVorhanden` nutzt `client.query(text, [rolle])`, nicht `exec`. Grund: Das gibt es in `src/store/pg-runner.js:10` und liefert in Produktion und im Test eine Form; die Testbrücke kennt nur die Einzelform. Hinweis 21b (beide Formen lesen) entfällt (Hinweis 23). Die Frist von 5 s bleibt im Prozess.
- Abnahme von a2: Start ohne Rolle mit Adresse, Brücke und Zeitgeber-Attrappe; Rückruf des 60-000-ms-Zeitgebers auslösen; kein Messwert und kein Lauf-Client (`laufClients` leer). Danach im selben Prozess Rolle anlegen, Rechte geben, `schemaErneutAnwenden`, Rückruf erneut auslösen: `anrufe_heute` erscheint (Hinweis 18). Die frühere Gegenprobe über `appRolleErstelltRollen` entfällt, weil die Option nur beim Start wirkt.
- Testhilfe: Die Beschreibung bei u2 und u4 nennt nur noch die neuen Teile (`appRolleErstelltRollen`, `kennzahlenAdresse`, `unterKennzahlenLeser`, `ohneStartanruf`, `laufClients`). Grund: `zusatzRollen`, `appRolleDatenbankAnlegen`, `appRolleVerwaltetZusatzRollen`, `clientBruecke` und `schemaErneutAnwenden` gibt es schon (`test/abrechnung/server-mit-testdatenbank.js:61-71,214-217,275`); sie werden benutzt (Hinweis 7). Abnahme von u4 ist der Schematest, der als einziger bestehender Test `clientAufPglite` ausführt (Hinweis 22a).
- Master: Der Plan sitzt auf `upstream/master`. Dort pinnt `test/gemeinsam/konfiguration-oberflaeche.test.js` seit 972d090 Namen statt Anzahlen; die Annahme zu a1 nennt jetzt `store.kennzahlenDatabaseUrl` in `PINNED_NAMES`. Die Zeilenangaben zu `src/store.js` sind nachgezogen.
- Sätze der Planung (Hinweise 21 und 22 im Pitch): Fehlerweg des Zeitgebers löscht die Momentaufnahme und der Abbruch der Abfrage läuft auf dem Server. Grund: Die Prüfung der Planung fand diese Sätze ohne Auftrag, der sie brechen kann; alle stammen aus Design Doc und Pitch.
- Zuschnitt: Testhilfe-Änderungen nur in Testumbauten (CREATEROLE-Option mit Schematest; Brücke unter `kennzahlen_leser`, `ohneStartanruf`, Liste der Lauf-Clients), Schlüssel `KENNZAHLEN_DATABASE_URL` in `config.js`, `.env.example` und `render.yaml` im Auftrag des Takts. Grund: Die Skriptprüfung lässt Testhilfe-Änderungen nur in einem Testumbau zu und verbietet einem Umbau, seine eigene Abnahme zu ändern; die älteren Hinweise 9, 14 und 16 widersprachen dem. Die Abweichung von diesen Hinweisen steht in Hinweis 22 und in den Annahmen der Phase.
- Abkürzung „bzw.“ im Pitch-Hinweis ausgeschrieben. Grund: Der Punkt teilte Sätze in der Prüfung der Nie-Sätze.
