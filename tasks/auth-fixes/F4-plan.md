# F4 — WITH CHECK auf allen RLS tenant_isolation-Policies

## Kontext

`src/db/schema.sql` Zeilen 217–246: 10 `CREATE POLICY tenant_isolation`-Anweisungen
verwenden ausschliesslich `USING (tenant_id = current_setting('app.current_tenant', true))`.

Postgres-Verhalten bei `FOR ALL` ohne explizites `WITH CHECK`:
- Die USING-Expression gilt implizit auch als WITH CHECK (Postgres-Doku §5.8).
- Das ist aber eine stille, nicht-sichtbare Konvention: ein kuenftiger Edit, der eine
  Policy in `FOR SELECT` + `FOR INSERT/UPDATE` aufteilt und das WITH CHECK vergisst,
  reisst das Loch ohne Compiler-Fehler auf.
- Explizites WITH CHECK macht die Absicht lesbar und verhindert stille Regressionen.

> Pre-Mortem: Was passiert, wenn dieser Fix selbst einen Fehler hat?
> Risiko: WITH CHECK-Expression weicht von USING ab -> legitime Inserts werden geblockt.
> Massnahme: Expression ist identisch zu USING (kein Drift moeglich), Test beweist das
> positiv (legitimer Insert unter korrekter GUC muss durchgehen).

---

## Akzeptanzkriterien (binaer pruefbar)

1. **AC1 — Alle 10 Policies haben WITH CHECK.** Jede der 10 `CREATE POLICY tenant_isolation`-
   Anweisungen in `schema.sql` enthaelt `WITH CHECK (tenant_id = current_setting('app.current_tenant', true))`.
   Die USING-Klausel bleibt unveraendert.

2. **AC2 — Schema bleibt idempotent.** `applySchema()` darf zweimal ausgefuehrt werden, ohne
   Fehler. Das `DROP POLICY IF EXISTS`-vor-`CREATE`-Muster bleibt erhalten.

3. **AC3 — INSERT mit fremder tenant_id wird von der Policy abgelehnt.**
   Unter `SET ROLE app_user` + GUC `app.current_tenant = tenant_a` scheitert ein INSERT in
   `call` mit `tenant_id = tenant_b` mit einem `row-level security|policy`-Fehler.

4. **AC4 — UPDATE das tenant_id auf fremden Tenant aendert, wird abgelehnt.**
   Unter `SET ROLE app_user` + GUC `app.current_tenant = tenant_a` scheitert ein UPDATE
   `SET tenant_id = tenant_b` auf einer bestehenden tenant_a-Zeile mit demselben Fehler.

5. **AC5 — Legitimer INSERT (passende tenant_id) bleibt erlaubt (Gegenpruefe).**
   Unter `SET ROLE app_user` + GUC `app.current_tenant = tenant_a` gelingt ein INSERT in
   `call` mit `tenant_id = tenant_a` ohne Fehler.

6. **AC6 — `npm test` laeuft ohne Fehler** (alle bestehenden + neuen Tests gruen).

---

## Test-Cases (node:test, TDD-first)

**Datei:** `test/rls-with-check.test.js` (neu)

Muster wie `test/store-pg-rls.test.js`:
- PGlite als In-Process-Postgres (kein Netz, keine externe DB -> F.I.R.S.T.)
- `SET ROLE app_user` + `NOBYPASSRLS` simuliert Produktion
- `applySchema()` + minimales Seeding als Superuser, dann DML als unprivilegierte Rolle

### Setup (geteilt, extract to helper)

```
Given: frische PGlite-Instanz, Schema angewendet via applySchema()
       tenant_a und tenant_b in Tabelle tenant angelegt (Superuser)
       Rolle app_user: NOLOGIN, NOBYPASSRLS,
         GRANT SELECT/INSERT/UPDATE/DELETE ON call, settings, transcript_segment,
           action_item, calendar_event, usage, profile, notification, number,
           number_assignment TO app_user;
         GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user;
```

---

### T1 — INSERT mit korrekter tenant_id (Gegenpruefe, AC5)

```
Name:  "WITH CHECK: INSERT mit korrekter tenant_id passiert RLS"
Given: Setup (s.o.), SET ROLE app_user, GUC app.current_tenant = tenant_a
When:  INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
       VALUES ('c_ok', 'tenant_a', 'tok', 'inbound', 'active', now()::text)
Then:  kein Fehler, Zeile ist in der DB (SELECT count = 1 als Superuser)
```

### T2 — INSERT mit fremder tenant_id wird abgelehnt (AC3)

```
Name:  "WITH CHECK: INSERT mit fremder tenant_id wird von RLS blockiert"
Given: Setup, SET ROLE app_user, GUC app.current_tenant = tenant_a
When:  INSERT INTO call (id, tenant_id, ...)
       VALUES ('c_evil', 'tenant_b', 'tok', 'inbound', 'active', now()::text)
Then:  assert.rejects mit /row-level security|policy/i
```

### T3 — INSERT ohne GUC (leerer Kontext) wird abgelehnt

```
Name:  "WITH CHECK: INSERT ohne GUC wird von RLS blockiert (fail-closed)"
Given: Setup, SET ROLE app_user, GUC NICHT gesetzt (current_setting returns NULL/empty)
When:  INSERT INTO call (id, tenant_id, ...)
       VALUES ('c_noguc', 'tenant_a', 'tok', 'inbound', 'active', now()::text)
Then:  assert.rejects mit /row-level security|policy/i
```

### T4 — UPDATE aendert tenant_id auf fremden Tenant (AC4)

```
Name:  "WITH CHECK: UPDATE das tenant_id auf fremden Tenant setzt, wird blockiert"
Given: Setup, als Superuser eine call-Zeile fuer tenant_a anlegen (id='c_update')
       SET ROLE app_user, GUC app.current_tenant = tenant_a
When:  UPDATE call SET tenant_id = 'tenant_b' WHERE id = 'c_update'
Then:  assert.rejects mit /row-level security|policy/i
```

### T5 — UPDATE auf eigener Zeile ohne tenant_id-Aenderung bleibt erlaubt

```
Name:  "WITH CHECK: UPDATE eigener Zeile ohne tenant_id-Aenderung passiert RLS"
Given: Setup, als Superuser call-Zeile fuer tenant_a (id='c_update2')
       GRANT UPDATE (status) ON call TO app_user (reicht; alternativ: existing GRANT reicht bereits)
       SET ROLE app_user, GUC app.current_tenant = tenant_a
When:  UPDATE call SET status = 'completed' WHERE id = 'c_update2'
Then:  kein Fehler, Zeile hat status = 'completed'
```

### T6 — Idempotenz: applySchema zweimal -> kein Fehler (AC2)

```
Name:  "Schema-Idempotenz: applySchema zweimal aufrufen wirft keinen Fehler"
Given: frische PGlite-Instanz
When:  applySchema() zweimal nacheinander aufgerufen
Then:  beide Aufrufe ohne Fehler (kein assert.rejects, kein thrown error)
```

---

## Dateien (exakt)

### Zu aendern

| Datei | Aenderung |
|---|---|
| `src/db/schema.sql` | Alle 10 `CREATE POLICY tenant_isolation`-Bloecke um `WITH CHECK (tenant_id = current_setting('app.current_tenant', true))` ergaenzen. USING-Klausel bleibt. DROP-vor-CREATE-Muster bleibt. |

### Neu anlegen

| Datei | Inhalt |
|---|---|
| `test/rls-with-check.test.js` | 6 node:test-Cases T1–T6 (s.o.). Kein import von store/pg.js noetig — direkte pglite + applySchema-Nutzung wie in store-pg-rls.test.js. |

### Nicht anfassen

- `src/db/migrate.js` — nur Schema-Datei-Pfad, keine Policy-Logik
- `test/store-pg-rls.test.js` — bestehender Test T5 (Zeile 119) bleibt; F4 ergaenzt, verdraengt nicht
- Alle anderen src/-Dateien

---

## Implementierungsreihenfolge (Build-Agent)

1. `test/rls-with-check.test.js` anlegen (Test-first: alle 6 Tests ROT wegen fehlenden
   WITH CHECK, ausser T6 der schon gruen ist).
2. `src/db/schema.sql` aendern: alle 10 Policies um WITH CHECK ergaenzen.
3. `node --check src/db/schema.sql` — n.z. (SQL, kein JS). Stattdessen: `npm test` reicht
   als Verifikation (pglite fuehrt das SQL aus, Syntaxfehler fliegen sofort auf).
4. `npm test` — alle Tests gruen.

---

## Postgres-Notiz fuer den Build-Agenten

`FOR ALL` ohne `WITH CHECK`:
- Postgres wendet USING implizit als WITH CHECK an (gilt fuer INSERT + UPDATE neue Zeile).
- Test T2 wuerde also *auch vor dem Fix* bestehen (implizite WITH CHECK).
- T4 (UPDATE auf tenant_id-Wechsel) ist der haertere Nachweis: er prueft explizit, dass die
  neue Zeile nach dem UPDATE die WITH CHECK passiert. Ohne explizites WITH CHECK verlaesst
  man sich auf implizites Verhalten, das bei Policy-Splits verloren geht.
- Nach dem Fix sind USING und WITH CHECK identisch und explizit -> kein Drift-Risiko.

Konsequenz: T1–T5 sind nach dem Fix alle gruen. T2/T3/T4 sind die eigentlichen Sicherheits-
Nachweis-Tests; T1/T5 sind Gegenproben (kein False Positive). T6 prueft Idempotenz.
