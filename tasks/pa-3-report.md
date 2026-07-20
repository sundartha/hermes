# Phase PA-3 — Detailbericht

**Fund:** S1 `setTenant` fehlte vor `hydrateTenantInto` im `ensureTenant`-Abwesend-Zweig (RLS-Datenintegritaet)
**Gate:** BLOCKED
**finalBranch:** `phase/polish-a-p3-fix2`

---

## 1. Bug-Verankerung (gegen `master`)

- **Bug (bestaetigt):** `src/store/pg.js::ensureTenant` rief im Abwesend-Zweig `hydrateTenantInto(client, state, tenantId)` (direkt nach `state.tenants.push(...)`) **ohne vorher** `setTenant(client, tenantId)` auf. Die tenant-scoped Tabellen haben `ENABLE + FORCE ROW LEVEL SECURITY` mit Policy `USING (tenant_id = current_setting('app.current_tenant', true))` (`schema.sql`). Laeuft `ensureTenant` auf einer Pool-Verbindung, deren Session-GUC noch auf einem **anderen** Tenant steht (Owner/BOOTSTRAP aus `init`/vorherigem `attach`), filtert RLS jede `SELECT ... WHERE tenant_id=$1` in `hydrateTenantInto` **leer**. Der frisch registrierte Tenant landet im Spiegel **ohne** seine nicht-aktiven Call-Zeilen.
- **Datenverlust-Kette:** Der naechste `flush()` iteriert `state.tenants` (enthaelt den neuen Tenant), setzt die GUC transaktionslokal und ruft `flushCalls` -> `deleteMissingCallsKeepActive(client, tenantId, keepIds=[])`. Leere keep-Liste -> `DELETE FROM call WHERE tenant_id=$1 AND status <> 'active'`. Die realen nicht-aktiven Zeilen werden geloescht. Aktive Zeilen sind geschuetzt, nicht-aktive nicht -> **stiller Datenverlust**.
- **Referenzmuster (G5):** `hydrate()` macht es korrekt — `await setTenant(client, tenant.id); await hydrateTenantInto(client, state, tenant.id);` (analog `attachActiveCall`, `portal.js`). Jeder tenant-scoped `withClient`-Pfad im Repo setzt die GUC vor dem Read. `ensureTenant` war die **einzige** Ausnahme.
- **Warum die Test-Rolle Pflicht ist (PM-7):** PGlite laeuft als Superuser; Superuser umgehen **FORCE** RLS. Ein Test als Superuser saehe die Zeile mit UND ohne Fix -> gruen ohne Beweis. Der Test muss unter `SET ROLE` auf eine **NOBYPASSRLS**-Rolle laufen (Muster der Bestands-Tests `OWNER_ROLE`).

**Blast-Radius (geplant):** 1 Produktions-Zeile (+ WHY-Kommentar) in `src/store/pg.js`; additive Tests in `test/store-pg-rls.test.js`. Kein neuer Import, keine Signaturaenderung, kein anderer pg.js-Pfad. `test/helpers.js` unberuehrt.

---

## 2. Plan (gekuerzt)

### 2a. Fix in `src/store/pg.js`

Im Abwesend-Zweig von `ensureTenant`, **nach** `state.tenants.push(...)` und **vor** `hydrateTenantInto`. Platzierung bindend: **nicht** zwischen den synchronen `raced`-Check (`ops.findTenant`) und den `push` (RACE-GUARD, "KEIN await dazwischen"). `setTenant` gehoert hinter `push`, exakt wie `hydrate()`.

```js
state.tenants.push(rowToTenant(full));
// RLS-GUC dieses Tenants SETZEN, bevor tenant-scoped gelesen wird (Muster hydrate():
// setTenant vor hydrateTenantInto, G5). ... ohne sie filtert FORCE RLS unter der
// stale/fremden GUC einer wiederverwendeten Pool-Verbindung die Reads LEER -> der leere
// Spiegel liesse den naechsten Flush die realen nicht-aktiven Call-Zeilen loeschen
// (deleteMissingCallsKeepActive mit leerer keep-Liste = stiller Datenverlust).
await setTenant(client, tenantId);
// tenant-scoped Zeilen nachladen (settings/calls/...): fuer einen frischen Signup
// leer (nichts angelegt), aber zukunftssicher. Eigener tenant_id-Filter je Query
// (zweite Linie zur RLS) - kein Cross-Tenant-Leck.
await hydrateTenantInto(client, state, tenantId);
return true;
```

Kein weiterer pg.js-Pfad angefasst; explizit **nicht** die "saubere" Variante (setTenant in `hydrateTenantInto` kapseln), da das `hydrate()` mit-veraendert und den Scope sprengen wuerde.

### 2b. Regressionstest in `test/store-pg-rls.test.js`

- Geteilter Helfer `pgliteRunner(db)` (G5, extrahiert statt dupliziert), Bestands-`setup()` darauf umgestellt (verhaltens-erhaltend).
- Neue Konstanten `SIGNUP_TENANT_ID`, `LOST_CALL_ID`, `ENSURE_ROLE` (NOBYPASSRLS).
- `setupSignup()`: seedet Owner (Superuser), legt frischen Tenant + eine bereits **beendete** (nicht-aktive) Call-Zeile direkt in die DB, erstellt `ENSURE_ROLE` mit reinem `SELECT` auf alle von `hydrateTenantInto` gelesenen Tabellen (kein `permission denied`, sondern echtes RLS-Leerfiltern).
- `ensureTenantAs(db, store, role)`: pinnt die GUC vorher explizit auf den Owner (simuliert eine wiederverwendete Pool-Verbindung), ruft `store.ensureTenant` optional unter `SET ROLE` auf.
- **Haupttest** (rot-vor-Fix): beweist (a) Spiegel-Hydrierung der nicht-aktiven Call-Zeile und (b) Ueberleben nach `store.save()` + `await store.drainFlushes()` per direktem `SELECT`.
- **Gegenprobe:** ohne `SET ROLE` (Superuser) ist die Zeile ohnehin sichtbar -> belegt, dass die NOBYPASSRLS-Rolle fuer den Haupttest tragend ist.

### 3. Rot-vor-Fix-Beweis (Pflicht PM-7)

Ohne Fix: GUC bleibt auf BOOTSTRAP -> `callRows` leer -> Spiegel ohne Call -> Assertion (a) `undefined`, Assertion (b) 0 Zeilen -> **rot**. Gegenprobe bleibt gruen (Superuser). Mit Fix: GUC=SIGNUP -> Call im Spiegel, ueberlebt Flush -> beide **gruen**. Sowohl Impl-Agent als auch Safety-Reviewer mussten den Toggle unabhaengig nachvollziehen.

### 4. Clean-Code-Selbstpruefung (Plan)

G31 (temporale Kopplung) geschlossen; G5 (Wiederverwendung des `hydrate()`-Musters, `pgliteRunner` als eine Quelle); keine neuen Magic Numbers; kein toter/auskommentierter Code; `setTenant` als sprechender Name (N7); Testhelfer nach Build/Operate getrennt (P13), <=3 Argumente (F1); neues Verhalten mit automatisiertem Regressionstest belegt.

### 5. Pre-Mortem (Plan)

- **Session-GUC-Leak durch den Fix?** Kein neues Risiko — jeder tenant-scoped Konsument setzt seine GUC ohnehin selbst vor dem Read; der Fix reduziert eher stale GUC-Zustaende, kein Reset ergaenzt (out-of-scope, analog `hydrate`/`attachActiveCall`).
- **Test worthless als Superuser:** durch NOBYPASSRLS-Rolle + Gegenprobe abgesichert.
- **Falscher Ort der Fix-Zeile (Race-Guard-Bruch):** explizit auf "nach `push`, vor `hydrateTenantInto`" gepinnt.

### 6. Deterministisch pruefbares Ergebnis (Plan-Vorgabe)

1. `node --check src/store/pg.js` -> Exit 0.
2. `node --test test/store-pg-rls.test.js` -> 10/10 gruen (8 Bestand + 2 neu).
3. Rot-vor-Fix: Fix-Zeile temporaer entfernen -> `# fail 1` (nur der neue Haupttest), Gegenprobe bleibt gruen; Zeile zurueck -> `# fail 0`.
4. `npm test` -> gruen (bekannter Voll-Last-Flake `suite-flake-p5-gate-proof` nur werten, wenn isoliert reproduzierbar).

Betroffene Pfade: `src/store/pg.js` (Fix), `test/store-pg-rls.test.js` (Tests); nur gelesen/verifiziert: `src/db/schema.sql`, `src/store/state-ops.js`, `test/helpers.js` (unangetastet).

---

## 3. Impl-Zusammenfassung + Deviations

- **headCommit:** `df1b5ce7cbee5eaeb04d8f54b85fb32a78c5e9e1`
- **nodeCheckPass:** true — **testsPass:** true — **testPassCount:** 2370 — **testFailCount:** 0
- **committed:** true (Branch `phase/polish-a-p3`)
- **filesEdited:** `src/store/pg.js`, `test/store-pg-rls.test.js`
- **filesCreated:** keine
- **testsAddedOrChanged:**
  - `PA-3/S1-1 (rot-vor-Fix): ensureTenant hydriert nicht-aktive Call-Zeile unter FORCE RLS - kein Flush-Datenverlust`
  - `PA-3/S1-1 Gegenprobe: als Superuser (BYPASSRLS) faellt der Bug NICHT auf`
  - `setup()`-Runner-Konstruktion auf geteilten `pgliteRunner(db)`-Helfer umgestellt (verhaltensneutral, 8 Bestandstests unveraendert gruen)
- **smokePass:** true — Server (JSON-Backend, `DATA_DIR`-Temp via `scripts/bootstrap-tenant.js` geseedet) bootet sauber, `/healthz` -> 200. Der pg-spezifische Fix wird ueber die pglite-RLS-Suite (echte Integration mit FORCE RLS) abgedeckt, nicht ueber den JSON-Smoke-Test — das ist der einzig sinnvolle Weg, da `STORE_BACKEND=pg` fuer den curl-Smoke einen echten Postgres/pglite-Runner braeuchte, den die Suite bereits bietet. Prozess sauber beendet.

**cleanCodeSelfCheck (Impl):** Fix = eine Zeile (`await setTenant(client, tenantId);`) + WHY-Kommentar in `src/store/pg.js::ensureTenant`, exakt nach dem `hydrate()`-Muster (G5). G31 (verborgene zeitliche Kopplung) war die Wurzel, jetzt geschlossen. Kein anderer pg.js-Pfad angefasst. `pgliteRunner(db)` als eine Quelle extrahiert (G5) statt zweier identischer Runner-Objekte. `setupSignup()` (Build) und `ensureTenantAs(db, store, role)` (Operate, 3 Argumente, F1-konform) sauber getrennt (P13). Keine Magic Numbers, kein toter/auskommentierter Code, keine ungenutzten Imports.

**deviations:**
1. Ein Wort-Detail des Plan-Snippets korrigiert: im Gegenprobe-Test-Kommentar stand woertlich "(wie die Bestands-Gegenprobe Zeile 137)" — ein brittle Datei:Zeile-Bezug, der der eigenen Clean-Code-Anforderung des Plans widersprach ("Kommentar aktuell und ohne Datei:Zeile-Bezug"). Ersetzt durch eine beschreibende Referenz ohne Zeilennummer; keine Verhaltens-/Assertions-Aenderung.
2. `npm run lint` (eslint) konnte im Worktree nicht laufen (`ERR_MODULE_NOT_FOUND: @eslint/js` ueber den symlinkten `node_modules`) — Umgebungsproblem, nicht auf diesen Diff zurueckzufuehren, nicht Teil der geforderten Pruefkette. `npx prettier --check` meldet fuer beide Dateien Formatierungs-Warnungen, aber identisch bereits auf `master` vor jeder Aenderung (verifiziert per `git show master:<datei>` + separatem Prettier-Check) — keine Regression.
3. Voll-Suite zeigt 2370/0 statt der im Plan genannten Baseline 2362+2=2364 — die Plan-Baseline-Zahl ist offenbar aus einem frueheren Repo-Stand und stale; keine neuen Fehlschlaege, kein bekannter Flake getroffen.

---

## 4. Safety-Urteil (final)

**approved:** true
**testsPassIndependently:** true — **safetyGatesIntact:** true — **disclosureIntact:** true — **authFailClosedIntact:** true — **noSecretsLeaked:** true — **scopeRespected:** true — **behaviorAsIntended:** true

**independentTestSummary:** Beide Backends in einem Lauf gruen: `NODE_ENV=test node --test test/*.test.js` -> 2370 pass / 0 fail (JSON-Spawn-Tests + pg-pglite-Tests, kein Netz). Zielfile isoliert: 10/10 pass.

Rot-vor-Fix unabhaengig nachvollzogen (Pflicht PM-7): Fix-Zeile `await setTenant(client, tenantId);` in `src/store/pg.js:507` (ensureTenant Abwesend-Zweig) temporaer entfernt und Testfile erneut ausgefuehrt. Ohne Fix: `PA-3/S1-1 (rot-vor-Fix)` failt mit `AssertionError, actual: null` an Assertion (a); die Superuser-Gegenprobe blieb gruen. Mit Fix (byte-genau via `git checkout` wiederhergestellt): beide gruen, 10/10. Damit bewiesen: (1) der Test detektiert den Bug echt, (2) die NOBYPASSRLS-Rolle ist tragend — die Superuser-Gegenprobe ist mit und ohne Fix gruen und beweist fuer sich nichts.

NOBYPASSRLS unabhaengig verifiziert: Test legt `CREATE ROLE ensure_role NOLOGIN NOBYPASSRLS` an und ruft `store.ensureTenant` unter `SET ROLE ensure_role` mit vorher auf BOOTSTRAP gepinnter GUC auf (simuliert die wiederverwendete Pool-Verbindung). FORCE RLS ist real aktiv (`schema.sql:416`, `ALTER TABLE call FORCE ROW LEVEL SECURITY`). Fix spiegelt exakt das `hydrate()`-Muster (G5).

Datenverlust-Beweis echt: Test macht nach `ensureTenant` `store.save()` + `await store.drainFlushes()` (reale Store-Methode, `pg.js:122`) und beweist per direktem `SELECT id FROM call` das Ueberleben der nicht-aktiven Zeile.

**blockers:** keine.

**concerns (nicht-blockierend):**
1. Nach `ensureTenant` bleibt die Session-GUC (`set_config false`) auf dem Signup-Tenant der Verbindung gesetzt — spiegelt aber exakt das bestehende `hydrate()`-Loop-Muster; jeder tenant-scoped Schreib-/Lesepfad setzt seine eigene GUC selbst. Kein neuer Leak, spec-konform.
2. `test/store-pg-rls.test.js` erhielt zusaetzlich einen G5-Refactor (SET-ROLE-Boilerplate -> gemeinsamer Helper, `makePgTestStore`-Reuse). Auf die phasen-eigene Testdatei beschraenkt, verhaltens-erhaltend (alle Bestandstests gruen), kein Scope-Verstoss in fremden Code, keine neue npm-Dependency.

**verdict:** APPROVED. Diff beruehrt nur `src/store/pg.js` (1 `setTenant`-Aufruf + 6 Kommentarzeilen) und `test/store-pg-rls.test.js`. Rot-vor-Fix unter NOBYPASSRLS-Rolle unabhaengig reproduziert. FORCE RLS bleibt aktiv. Volle Suite 2370/0 beide Backends. Safety-Gates unberuehrt, `ensureTenant` liest weiter realen DB-Status. Disclosure nicht im Diff. Auth fail-closed intakt. Keine Secrets geloggt/geleakt. JSON-Backend byte-identisch (`pg.js` ungenutzt). Working Tree nach Verifikation sauber wiederhergestellt.

---

## 5. Clean-Code-Audit (final)

**verdict:** PASS mit einem S2-Hinweis (nicht sicherheitskritisch, aber G5-relevant). **blocker:** true (Katalogregel: 2 S2 hart als Blocker definiert; siehe Fix-Runden — dieser Blocker wurde in den nachfolgenden Runden behoben).

### s1 (Blocker)
Keine.

### s2 (Blocker)
- **G5** · `src/store/pg.js:507-511` (ensureTenant) + `553-554` (hydrate): Die Sequenz `await setTenant(...); await hydrateTenantInto(...);` steht jetzt woertlich an **zwei** Call-Sites — genau das Muster, dessen Fehlen (fehlendes `setTenant` an einer der beiden Stellen) den gefixten Datenverlust-Bug verursacht hat (G31, temporale Kopplung). Die Duplizierung ist neu durch diesen Diff entstanden (vorher nur 1 Vorkommen) und macht den Fix erneut caller-discipline-abhaengig statt strukturell zu erzwingen. Fix-Vorschlag: eine Funktion `hydrateTenant(client, state, tenantId)` einfuehren, die `setTenant` + `hydrateTenantInto` kapselt; beide Call-Sites darauf umstellen — eliminiert die Duplizierung und macht eine dritte, kuenftige Call-Site strukturell sicher (G27).

### s3 (nicht-blockierend)
- **F1** · `test/store-pg-rls.test.js:80` (`async function withRole(db, role, tenantId, fn)`): 4 Parameter ueberschreiten die 3er-Grenze. Geringe Prioritaet (privater Test-Helper, aktuell nur 2 Aufrufformen sauber gekapselt); `role`+`tenantId` liessen sich zu einem Optionsobjekt buendeln, falls eine dritte Aufrufform dazukommt.

### s4
Keine.

**passNotes:**
1. Der Kern-Fix (7 Zeilen in `src/store/pg.js`) ist korrekt: exakt das Muster aus `hydrate()`. Kausaler Kern des Kommentars ("wiederverwendete Pool-Verbindung mit stale/fremder GUC") gegen die echte Produktions-Verdrahtung geprueft (`src/store.js`: `pool.connect()`/`client.release()` ohne Session-Reset) — zutreffend, nicht spekulativ.
2. Rot-vor-Fix / gruen-nach-Fix selbst nachvollzogen (master-Version von `pg.js` in den Branch-Test eingesetzt: Test faellt exakt mit erwarteter `AssertionError`; Fix zurueckgesetzt: 10/10 gruen).
3. Die "Gegenprobe"-Tests (Superuser umgeht RLS) sind vorbildliche F.I.R.S.T./P12-Praxis — beweisen aktiv, dass der `ENSURE_ROLE`-Regressionstest nicht-trivial ist.
4. Die GRANT-Liste der neuen `ENSURE_ROLE` deckt exakt die von `hydrateTenantInto` gelesenen Tabellen ab — vermeidet False Negative durch `permission denied` statt RLS-leer-gefiltert.
5. Runde 1 und Runde 2 dieses Branches hatten bereits zwei eigene G5-Funde (SET-ROLE/RESET-ROLE-Skelett 4x dupliziert -> `withRole()`; `pgliteRunner` dupliziert gegen bestehendes `test/pg-helpers.js`) sauber behoben — der Review-Loop hat auf diesem Branch bereits funktioniert.
6. Volle Testsuite der pg-Backend-Tests (51 Tests ueber `store-pg.test.js`, `profile-a3-backfill-pg.test.js`, `self-service-mirror-hydration.test.js`, `tenant-prolif-b.test.js`, `store-pg-rls.test.js`) laeuft auf dem finalen Diff gruen.

**topTodos:**
1. S2 beheben: `setTenant`+`hydrateTenantInto` in `src/store/pg.js` zu einer Funktion `hydrateTenant(client, state, tenantId)` buendeln (beide Call-Sites) — macht die G31-Ordnungsinvariante strukturell statt per Kommentar/Disziplin sicher.
2. (optional, S3) `withRole()` in `test/store-pg-rls.test.js` auf 3 Argumente reduzieren (Optionsobjekt), falls eine dritte Aufrufform dazukommt.

---

## 6. Fix-Runden

**r1:** Branch `phase/polish-a-p3-fix1` von `phase/polish-a-p3` erstellt (HEAD war bereits `df1b5ce`, das den S1-Fix `setTenant`-vor-`hydrateTenantInto` in `src/store/pg.js::ensureTenant` + den PA-3/S1-1-Regressionstest inkl. NOBYPASSRLS-Rolle bereits enthielt — dieser S1-Fix war also schon vorhanden, nicht Teil dieser Runde).

**r2:** G5-Blocker in `test/store-pg-rls.test.js` behoben: die lokale Duplikat-Funktion `pgliteRunner(db)` (in `setup()` und `setupSignup()` genutzt) wurde ersatzlos gestrichen. Beide Setup-Funktionen nutzen jetzt den zentralen, repo-weit 32-fach genutzten Helper `makePgTestStore()` aus `test/pg-helpers.js`.

**finalBranch:** `phase/polish-a-p3-fix2`

**Gate-Ergebnis:** BLOCKED — der finale Clean-Code-Audit-Blocker (G5-Duplizierung `setTenant`+`hydrateTenantInto` an zwei Call-Sites) ist im Report als offen dokumentiert; die Fix-Runden r1/r2 adressieren primaer die Testdatei-Duplizierung (`pgliteRunner` -> `makePgTestStore`), nicht die im finalen Audit genannte Produktionscode-Duplizierung in `src/store/pg.js`. Der topTodo "`hydrateTenant(client, state, tenantId)`-Helper einfuehren" bleibt fuer eine Folgerunde offen.
