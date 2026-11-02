# P-2654 Migrationen je Datenbank genau einmal, versioniert, unter Sperre

Status: freigegeben
Issue: 2654
Design Doc: nein, weil der Probe-Patch (`fertigstellen/S1d/probe.patch`) die Technik gemessen entschieden hat und es keinen gleich tragfähigen anderen Weg gibt, der Fertig-Kriterium und Squawk-Regel erfüllt.

## Absicht
Zwei Hermes-Instanzen sollen gegen dieselbe Datenbank starten und deployen können, ohne sich beim Migrieren in die Quere zu kommen. Dafür wendet der Start jede nummerierte Migrationsdatei je Datenbank genau einmal an, führt sie mit Prüfsumme in einer Versionstabelle und hält dabei eine Advisory-Sperre; jede Migration beginnt im Plattformbereich. Nicht gewollt: eine Schemaänderung in JavaScript, ein per Umgebungsvariable wählbarer Migrationsordner, eine weichere Prüfung, Änderungen an den Nachzügen oder an seedDefaults. Im Zweifel bricht der Start ab, statt halb zu migrieren.

## Problem
Heute führt jeder Start einer Hermes-Instanz das ganze Gesamtschema (`src/db/migrations/0001_ausgang.sql`) noch einmal aus, ohne zu merken, ob es schon lief, und ohne Sperre. Startet beim Deploy eine zweite Instanz, während die erste noch migriert, laufen beide Läufe gleichzeitig durch dieselben Tabellen; gemessen scheitern zwei gleichzeitige Starts auf frischer Datenbank. Eine von Hand beschädigte Datenbank heilt der nächste Start still, und niemand sieht, welche Schemaänderungen eine Datenbank schon hat.

## Ergebnis
Nach dieser Änderung wendet der Start jede Migrationsdatei je Datenbank genau einmal an, trägt sie mit Nummer, Name und Prüfsumme in `schema_migrations` ein, wartet, wenn eine andere Instanz gerade migriert, und endet mit Exit 1 und dem Dateinamen in der Meldung, wenn eine Migration scheitert oder sich eine angewendete Datei geändert hat.

## Grobe Lösung
Der Betreiber merkt beim Start: Die erste Instanz nimmt die Migrationssperre und migriert. Eine zweite Instanz, die zugleich startet, wartet, bis die Sperre frei ist, und findet dann nichts mehr zu tun. Eine bestehende Produktionsdatenbank ohne Versionstabelle wird beim ersten Start übernommen: Ausgangsmigration und Versionstabelle werden in einer Transaktion eingetragen, die Daten bleiben stehen; trifft diese Transaktion eine Sperre einer anderen Sitzung, gibt sie nach 2 Sekunden auf, statt andere Sitzungen zu blockieren, und der Start endet mit Exit 1. Wartet der Start auf die Migrationssperre, schreibt er das ins Log. `docs/RUNBOOK-RESTORE.md` hält fest: Ein Neustart repariert nichts mehr; der erste Deploy kann mit Exit 1 enden und ist zu wiederholen; ein Rollback auf den Stand vor dieser Änderung wird nicht unterstützt; Migrieren geht nur über eine direkte Sitzungsverbindung. Jede weitere Migration läuft in eigener Transaktion, beginnt im Plattformbereich und trägt sich erst nach Erfolg ein. Die vier Nachzüge und `seedDefaults` laufen weiter bei jedem Start, unter derselben Sperre. Kunden und Angerufene bemerken nichts.

## Fallen
- S1da legt die Migrationen als feste Liste im Code ab (`MIGRATION_READERS`, `src/db/migrate.js:11`), nicht als Ordner-Scan; der Kurzauftrag ging vom Ordner-Scan aus. Entscheidung: Die Liste bleibt, `0002` wird eine zweite Zeile darin; eine nicht eingetragene Datei im Ordner läuft nie mit.
- Die Migrationsprüfung verlangt `SET LOCAL lock_timeout` und `SET LOCAL statement_timeout` in neuen Migrationen (Squawk): `0002_versionstabelle.sql` trägt beide.
- Gewollte Änderung eines bestehenden Tests: `test/openai-t2-20-reviewer-seed-pg.test.js:180` (`Reviewer-Seed pg: Positiv-Kontrolle - der Server-Boot (makePgStore ohne Optionen) migriert weiter`) löscht vor dem Start die Einträge in `schema_migrations`, weil ein Start eingetragene Migrationen nicht mehr heilt; das Testschutz-Label setzt Antonio am PR.
- Der Mutationsjob in der CI hat kein Postgres: Sperre und Rücksetzen auf den Plattformbereich müssen auch gegen PGlite durch Tests abgedeckt sein.
- Ein Start heilt eine von Hand beschädigte Datenbank nicht mehr, wenn die Migration eingetragen ist; die Positiv-Kontrolle in `test/openai-t2-20-reviewer-seed-pg.test.js:180` setzt vor dem Start die Einträge zurück.
- Setzt S1c `statement_timeout` je Verbindung, bricht ein langes Warten an der Sperre ab und die zweite Instanz endet mit Exit 1, statt zu warten: Das gehört zum Schnitt von S1c, nicht hierher.

## Geänderte Dateien
- `src/db/migrate.js`
- `src/db/migrations/0002_versionstabelle.sql`
- `test/pg-helpers.js`
- `test/gemeinsam/migrationen-versioniert.test.js`
- `test/openai-t2-20-reviewer-seed-pg.test.js`
- `docs/RUNBOOK-RESTORE.md`
- `docs/sicherheitsgrenzen.md`

## Altfunktionen
- nicht berührt: `src/store/pg.js:makePgStore`, weil `init()` darin nur `prepareSchema` (= `migrate`) aufruft und die Änderung in `src/db/migrate.js` liegt; `src/store/pg.js` ändert sich nicht.
- nicht berührt: `src/web-auth.js:resolveOrCreateTenant`, weil der Login unverändert bleibt; die Migrationssperre liegt in der Zwei-Schlüssel-Form und kollidiert nicht mit seiner Sperre, `src/web-auth.js` ändert sich nicht.
- nicht berührt: `src/web-auth.js:anonym ab Zeile 332`, weil dort nur der Login-Ablauf als Beleg zitiert ist und `src/web-auth.js` sich nicht ändert.

## Anforderungen

### Regel R1: Jede Migrationsdatei wird je Datenbank genau einmal angewendet und mit Nummer, Name und Prüfsumme eingetragen.

#### Szenario S1: Frische Datenbank
Gegeben eine leere Postgres-Datenbank
Wenn eine Instanz mit `npm start` startet
Dann antwortet `GET /healthz` mit 200
Und `SELECT version, name FROM schema_migrations ORDER BY version` liefert `1`/`0001_ausgang` und `2`/`0002_versionstabelle`

#### Szenario S2: Zweiter Start
Gegeben eine Instanz ist einmal gegen die Datenbank gestartet und der Index `account_email_idx` ist danach von Hand entfernt
Wenn die Instanz erneut mit `npm start` startet
Dann fehlt `account_email_idx` weiterhin

#### Szenario S3: Bestehende Datenbank ohne Versionstabelle
Gegeben eine Datenbank mit Konten, aber ohne Tabelle `schema_migrations`
Wenn eine Instanz mit `npm start` startet
Dann liefert `SELECT version FROM schema_migrations ORDER BY version` die Zeilen `1` und `2`
Und die Anzahl der Konten ist unverändert

#### Szenario S4: Übernahme scheitert
Gegeben eine Datenbank ohne Tabelle `schema_migrations`, in der `0002_versionstabelle.sql` scheitert
Wenn eine Instanz mit `npm start` startet
Dann endet der Prozess mit Exit 1
Und die Fehlermeldung nennt `0001_ausgang.sql` und `0002_versionstabelle.sql`
Und die Tabelle `schema_migrations` existiert nicht

#### Szenario S13: Jede Migrationsdatei ist eingetragen
Gegeben eine leere Postgres-Datenbank
Wenn eine Instanz mit `npm start` startet
Dann liefert `SELECT name FROM schema_migrations ORDER BY version` genau einen Namen je Datei der Migrationsliste im Code, ohne `.sql`, und nach S1 sind das `0001_ausgang` und `0002_versionstabelle`

### Regel R2: Weicht eine angewendete Datei ab oder scheitert eine Migration, bricht der Start ab und nennt die Datei.

#### Szenario S5: Prüfsumme weicht ab
Gegeben `schema_migrations` führt für Nummer 1 eine andere Prüfsumme als `0001_ausgang.sql`
Wenn eine Instanz mit `npm start` startet
Dann endet der Prozess mit Exit 1
Und die Fehlermeldung nennt `0001_ausgang.sql`

#### Szenario S6: Migration scheitert
Gegeben eine Datenbank mit Versionstabelle ohne Eintrag für Nummer 2, und der Test lässt die Ausführung von `0002_versionstabelle.sql` über einen Wrapper um die Verbindung mit einem SQL-Fehler abbrechen
Wenn eine Instanz mit `npm start` startet
Dann endet der Prozess mit Exit 1
Und die Fehlermeldung nennt `0002_versionstabelle.sql`
Und `schema_migrations` hat keine Zeile mit Nummer 2

#### Szenario S7: Eintrag ohne Datei
Gegeben `schema_migrations` führt eine Nummer 9 mit Name `0009_spaeter`, zu der es keine Datei gibt
Wenn eine Instanz mit `npm start` startet
Dann antwortet `GET /healthz` mit 200
Und das Log enthält eine Zeile mit `0009_spaeter`

#### Szenario S12: Übernahme trifft eine offene Transaktion
Gegeben eine Datenbank mit Konten, aber ohne Tabelle `schema_migrations`, und eine andere Datenbanksitzung hält eine offene Transaktion mit einer Änderung an der Tabelle `number`
Wenn eine Instanz mit `npm start` startet
Dann endet der Prozess innerhalb von 30 Sekunden mit Exit 1 und die Fehlermeldung nennt `0001_ausgang.sql`
Und der `COMMIT` der anderen Sitzung gelingt

### Regel R3: Jede Migrationsdatei beginnt im Plattformbereich.

#### Szenario S8: Bereichswechsel in der Vorgängerdatei
Gegeben ein Wrapper um die Verbindung des Starts stellt nach der Ausführung von `0001_ausgang.sql` den Bereich mit `SELECT set_config('app.current_tenant', 'k-fremd', false)` auf Kunde "k-fremd" und liest zu Beginn der Ausführung von `0002_versionstabelle.sql` `current_setting('app.current_tenant', true)`
Wenn eine Instanz mit `npm start` startet
Dann liefert diese Auslesung `owner`, die Kennung des Plattformbereichs, und nicht "k-fremd"

### Regel R4: Zwei Instanzen migrieren nie zugleich.

#### Szenario S9: Zwei gleichzeitige Starts
Gegeben eine leere Postgres-Datenbank
Wenn zwei Instanzen gleichzeitig mit `npm start` starten
Dann antworten beide auf `GET /healthz` mit 200
Und `SELECT count(*) FROM schema_migrations WHERE version = 1` liefert `1`

#### Szenario S10: Andere Sitzung hält die Sperre
Gegeben eine andere Datenbanksitzung hält die Migrationssperre (Advisory-Sperre `classid` 72, `objid` 1 in der Zwei-Schlüssel-Form)
Wenn eine Instanz mit `npm start` startet
Dann antwortet `GET /healthz` nicht, solange die Sperre gehalten wird
Und nach dem Freigeben der Sperre innerhalb von 30 Sekunden mit 200

#### Szenario S11: Sperre während des Laufs
Gegeben eine Instanz migriert gerade
Wenn eine Abfrage `pg_locks` mit `locktype = 'advisory'`, `classid = 72`, `objid = 1` und `objsubid = 2` liest
Dann zeigt sie eine gehaltene Sperre, und unmittelbar nach dem ersten 200 von `GET /healthz` (spätestens 5 Sekunden danach, ohne Wiederholung der Abfrage) keine

#### Szenario S14: Warten wird gemeldet
Gegeben eine andere Datenbanksitzung hält die Migrationssperre (Advisory-Sperre `classid` 72, `objid` 1 in der Zwei-Schlüssel-Form)
Wenn eine Instanz mit `npm start` startet
Dann enthält das Log innerhalb von 5 Sekunden eine Zeile mit `Migrationssperre`

## Bleibt unverändert

### Szenario B1: Nachzüge laufen bei jedem Start
Gegeben ein Konto mit der E-Mail "Max@Example.com" in gemischter Schreibweise
Wenn eine Instanz mit `npm start` startet
Dann steht die E-Mail des Kontos als "max@example.com"

## Nicht-Ziele
- Nicht Teil dieser Änderung: ein Migrationsordner, der sich über Umgebungsvariable oder Option wählen lässt, weil das den Ort der Schemaänderungen vom Code lösen würde.
- Nicht Teil dieser Änderung: Änderungen an den vier Nachzügen oder an `seedDefaults`, weil sie unverändert bei jedem Start laufen sollen.
- Nicht Teil dieser Änderung: Schemaänderungen in JavaScript, auch nicht die Versionstabelle, weil die Migrationsprüfung DDL in JavaScript sperrt.
- Nicht Teil dieser Änderung: der Folgepunkt S1dc (Schema-Regel der Planung in `tools/auftrag/planung/schnitt.mjs`), weil er ein eigenes Werkzeug-Paket ist.
- Nicht Teil dieser Änderung: Rückwärtsmigrationen und der Rückbau-Ordner, weil sie ein späteres Paket sind.

- Nicht Teil dieser Änderung: Migrieren über eine Verbindung im pgBouncer-Transaktionsmodus, weil Migrationssperre und Mandantenbereich an der Serversitzung hängen; der Start braucht dafür eine direkte Sitzungsverbindung (Hinweis in `docs/RUNBOOK-RESTORE.md`).
- Nicht Teil dieser Änderung: gleichzeitiger Betrieb zweier Instanzen über den Start hinaus (Zustand im Speicher, Flush, Kostendecke), weil beides am Speicher einer Instanz hängt; diese Änderung macht nur das Migrieren beim Start gleichzeitig sicher.
- Nicht Teil dieser Änderung: ein Rollback auf einen Code-Stand vor dieser Änderung, nachdem eine weitere Migration angewendet ist, weil der alte Stand `0001` bei jedem Start ganz ausführt und `schema_migrations` nicht kennt (Hinweis in `docs/RUNBOOK-RESTORE.md`).
- Nicht Teil dieser Änderung: eine Startprüfung der Zeilensicherheit (RLS) und der Policy-Ausdrücke, weil sie als eigenes Folgepaket #2679 unmittelbar nach dieser Änderung und vor S2a folgt; bis dahin heilt ein Start eine abgeschaltete Policy nicht mehr (PM8).
- Nicht Teil dieser Änderung: eine Wartegrenze für die Migrationssperre, weil sie von den Verbindungs-Timeouts aus S1c abhängt.

## Neue Begriffe
- `schema_migrations`: Tabelle mit `version`, `name`, `checksum` je angewendeter Migration.
- `0002_versionstabelle.sql`: Migration, die `schema_migrations` anlegt.
- Migrationssperre: Advisory-Sperre in der Zwei-Schlüssel-Form `pg_advisory_lock(int4, int4)` mit `classid` 72 und `objid` 1, eigener Raum neben dem Einzelschlüsselraum des Logins.

## Offene Fragen

### Vor dem Bau zu klären
keine

### Vor dem Einschalten zu klären
- Worauf zeigt `DATABASE_URL` in Produktion: auf die Datenbank selbst (direkte Sitzungsverbindung) oder auf einen Pooler im Transaktionsmodus? Der Betreiber klärt das im Render-Dashboard, ohne das Geheimnis zu kopieren; Plan und Bau hält die Frage nicht auf, nur das Einschalten in Produktion.

### Kann warten
- Ob die Sperre mit einem Wartezeit-Limit versehen wird (Folge von S1c); bis dahin meldet S14 das Warten im Log.

## Premortem
| Nr. | Grund | Ausgang |
|---|---|---|
| PM1 | Weil S8 die Einstellung `app.tenant_id` nannte, die Hermes nirgends benutzt (es heißt `app.current_tenant`), wäre der Test grün, auch wenn eine Migration im Bereich eines fremden Kunden liefe, und Daten kämen zur falschen Person. | S8 (berichtigt) |
| PM2 | Weil die Übernahme `0001` samt Sperren auf rund 20 Tabellen in einer Transaktion hält, blockiert oder verklemmt sie beim ersten Deploy eine noch laufende alte Instanz, und deren Speicherstand geht verloren. | S12 |
| PM3 | Weil pgBouncer im Transaktionsmodus eine Sitzungssperre an eine fremde Serververbindung hängt, migrieren zwei Instanzen zugleich oder eine Sperre bleibt dauerhaft stehen und `/healthz` antwortet nie. | Nicht-Ziel: pgBouncer-Transaktionsmodus |
| PM4 | Weil S9 „zwei Instanzen starten“ zeigt, wird die Änderung als Freigabe für zwei laufende Instanzen gelesen, und sie überschreiben einander Zustand und überschreiten die Kostendecke. | Nicht-Ziel: Betrieb zweier Instanzen |
| PM5 | Weil eine neue Migration nur in der festen Liste im Code zählt, läuft eine Datei, die dort vergessen wurde, nie, und jeder Flush scheitert. | S13 |
| PM6 | Weil der Code vor dieser Änderung `0001` bei jedem Start ganz ausführt, setzt ein Rollback eine später geänderte Policy still zurück, während `schema_migrations` sie als angewendet führt. | Nicht-Ziel: Rollback auf den Stand vor dieser Änderung |
| PM7 | Weil der Start ohne Zeitgrenze auf die Sperre wartet und eine abgestürzte Instanz sie lange halten kann, hängt jeder Neustart ohne Hinweis im Log. | S14 |
| PM8 | Weil ein Start eingetragene Migrationen nicht mehr heilt, bleibt eine von Hand entfernte Policy oder ein abgeschaltetes FORCE RLS dauerhaft aus, und eine Lücke im App-Filter träfe Daten bei der falschen Person. | hingenommen bis zum Folgepaket #2679 (RLS-Startprüfung, unmittelbar nach dieser Änderung, vor S2a): das Ende des Heilens ist die Absicht (S2); Hinweis „Ein Neustart repariert nichts mehr“ im Runbook |
| PM9 | Weil eine feste Sperrnummer im Raum der Einzelschlüssel läge wie `hashtext(email)` in `src/web-auth.js:289`, könnte ein Anmeldender mit passender E-Mail Logins aller Kunden während eines Starts warten lassen. | S11 (Zwei-Schlüssel-Form, eigener Raum) |
