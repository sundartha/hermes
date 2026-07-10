# Spec: Fix 1 — Identitaets-Dedup (Tenant-/Nummern-Proliferation)

Autoritative Scope-/Design-/Invarianten-/Abgrenzungs-Definition fuer Fix 1. Vorrang vor dem
Umbrella-Doc `PLAN-TENANT-PROLIFERATION.md`. Grundlage: RCA `tasks/rca-tenant-number-proliferation.md`
Abschnitt 6 (Fix 1). Alle Zeilennummern sind nur Anker-Hilfen — die Symbole per grep verifizieren,
NIE Zeilennummern uebernehmen (sie rotten).

## Gemeinsamer Kontext (beide Phasen)

- **pg-only.** Der Web-Login und das `account`-Konzept existieren nur bei `STORE_BACKEND=pg`. Der
  json-Store hat kein account/Email. Fix 1 aendert das Web-/pg-Verhalten NUR im Merge-Fall; unter
  json bleibt alles byte-identisch.
- **`account`-Schema existiert bereits** (`src/db/schema.sql`, ~356-365): `sub` PK, `tenant_id`
  NICHT-unique, `email`, `created_at`. Mehrere subs pro Tenant sind schon schema-seitig erlaubt.
- **Merge-Regel: aeltester Tenant gewinnt** — deterministisch, transitiv. `ORDER BY created_at ASC
  LIMIT 1`. So treffen bestehende MCP-Tokens mit altem sub weiter denselben kanonischen Tenant.
- **email_verified-Gate ist unverhandelbar:** Merge NUR wenn die Email verifiziert ist. Der Gate
  sitzt in `claimsFromPayload` (`src/web-auth.js`, ~316-333, `email_verified===true` -> Email wird
  gesetzt; sonst bleibt sie leer/null). Diese Invariante NICHT aufweichen. Ist die Email nicht
  verifiziert -> KEIN Merge, normaler neuer Tenant (bzw. sauberer Reject, s. Phase A).

## Absolute Grenzen (beide Phasen)

- CLAUDE.md Regel 1-7 unberuehrt: Safety-Gates (Allowlist/Denylist/Land/Stundenlimit/Budget/
  Max-Dauer/Signatur), Offenlegungssatz, Auth-fail-closed. Kein Fix umgeht ein Gate.
- Keine neuen npm-Dependencies.
- Schema nur additiv/idempotent (`CREATE INDEX IF NOT EXISTS ...`), keine Versionierungstabelle.
- ESM, kein Build-Step, kein TypeScript. Kommentare deutsch OHNE Umlaute (ue/oe/ae).
- SCOPE strikt: NUR die jeweilige Phase. Kein DID-Release, kein `suspended_at`, kein Onboarding-
  Redesign — das ist Fix 2 bzw. spaeter.

---

## Phase tenant-prolif-a — Email-verifizierte Dedup am Web-Login (praeventiv, Web-Kanal)

### Ziel (ein Satz)

Beim Web-Login mappt ein neuer verifizierter sub, dessen Email schon einem Tenant gehoert, auf genau
diesen bestehenden Tenant (zusaetzliche `account`-Zeile) — statt einen neuen Tenant + spaeter eine
neue DID zu erzeugen.

### Betroffene Dateien (Anker per grep verifizieren)

- `src/web-auth.js` — `upsertOnFirstLogin` (~445-462), `claimsFromPayload` (~316-333).
- `src/db/schema.sql` — `account`-Tabelle (~356-365): nicht-unique Lookup-Index auf `email`.
- Test: `test/web-auth-pg.test.js` (bzw. die vorhandene pg-Web-Auth-Testdatei; pglite via
  `test/pg-helpers.js`).

### Design

1. **Dedup vor der `t_<sub>`-Ableitung.** In `upsertOnFirstLogin` (dem Pfad, der heute per
   `tenantIdForSubject(sub)` blind `t_<sub>` bildet und per `ON CONFLICT (id)` upsertet): wenn eine
   (also verifizierte) Email vorliegt, zuerst
   `SELECT tenant_id FROM account WHERE email=$1 ORDER BY created_at ASC LIMIT 1`.
   - **Treffer:** die gefundene `tenant_id` wiederverwenden. KEIN neuer Tenant, KEIN neuer DID-Kauf.
     Den neuen `sub` als zusaetzliche `account`-Zeile auf diese `tenant_id` schreiben.
   - **Kein Treffer:** heutiges Verhalten — neuer Tenant `t_<sub>` + `account`-Zeile.
2. **Transaktion.** Tenant-Upsert und account-INSERT laufen in EINER Transaktion (BEGIN/COMMIT,
   Rollback bei Fehler). Heute kann bei null-Email der Tenant-INSERT committen und der account-INSERT
   crashen -> Orphan-Tenant. Das schliessen.
3. **Unverifizierte/null-Email:** expliziter, geloggter Reject (heute laeuft es in einen
   unbeabsichtigten NOT-NULL-Crash -> generischer 401). Kein Verhaltensbruch — unverifiziert kann
   schon heute nicht einloggen; nur sauber und absichtsvoll gemacht. Kein Secret/PII ins Log
   (Email nicht loggen; Grund-Code genuegt).
4. **Index:** `CREATE INDEX IF NOT EXISTS account_email_idx ON account(email)` — **nicht-unique**
   (mehrere subs/Accounts pro Email teilen sich denselben Tenant; ein Unique-Index wuerde genau das
   brechen). Nur Lookup-Beschleunigung; die 1-Tenant-pro-Email-Invariante garantiert die Dedup-Logik,
   nicht der Index.

### Invarianten / Pre-Mortem

- email_verified-Gate hart (Account-Takeover-Vektor). Nicht aufweichen.
- Merge deterministisch (aeltester gewinnt) + transitiv, damit zwei subs nie in verschiedene
  Richtungen mergen.
- Praeventiv, nicht retroaktiv: die 4 Bestands-Tenants werden hier NICHT angefasst (Phase F).
- json-Backend byte-identisch (kein account/Web-Login dort).

### Tests (neues Verhalten braucht Test)

- **Merge-Fall:** zweiter Login (sub2, gleiche verifizierte Email wie sub1) -> gleiche `tenant_id`
  wie sub1, ZWEI `account`-Zeilen, EIN Tenant. Kein zweiter Tenant angelegt.
- **Kein-Treffer-Fall:** neuer sub mit neuer verifizierter Email -> neuer Tenant `t_<sub>` (heutiges
  Verhalten unveraendert).
- **Reject-Fall:** unverifizierte/null-Email -> definierter Reject, KEIN Tenant und KEIN account
  angelegt (kein Orphan).
- Transaktions-/Orphan-Schutz mit abgedeckt (bei erzwungenem Fehler kein halb-committeter Zustand).

### Deterministisch pruefbares Ergebnis

- `npm test` gruen (json-Default + pglite-in-process), inkl. der neuen pg-Web-Auth-Tests.
- `node --check` auf jede geaenderte .js-Datei.

---

## Phase tenant-prolif-b — MCP/REST-Kanal: sub->Tenant ueber account (synchroner Spiegel-Index)

### Ziel (ein Satz)

`resolveTenant(sub2)` (der synchrone Hot-Path fuer MCP/REST) liefert den kanonischen (gemergten)
Tenant — auch wenn `sub2` nur als zusaetzliche `account`-Zeile auf einem fremden `t_<sub1>` haengt —
statt den in `tenant.idp_subject` eingefrorenen 1:1-Spiegel zu befragen und den gemergten sub
abzulehnen.

### Betroffene Dateien (Anker per grep verifizieren)

- `src/store/state-ops.js` — `resolveTenant` (~1600-1604); neuer sub->tenantId-Index im
  In-Memory-State (in `makeDefaultState` anlegen).
- `src/store/pg.js` — Index bei `init()` aus `account` hydrieren; Bindung beim Nach-Boot-Login.
- `src/web-auth.js` — `mintSession` bindet den neuen sub nach dem Login in den Spiegel
  (`ensureTenant(tenantId)`-Aufruf um eine `bindSubToTenant(sub, tenantId)`-Mutation ergaenzen).
- `src/store.js` — Re-Export der neuen Store-Funktion(en), falls noetig.
- `src/routes/_tenant.js` — Konsument bleibt SYNCHRON (kein async-Umbau).
- `src/server.js` — Onboard-Pfad (~1949-1961): vor `registerTenant` ein `resolveTenant(sub)`-Check.
- Tests: `test/resolve-tenant.test.js`, `test/tenant-resolver-parity.test.js` (bzw. die vorhandenen
  Aequivalente).

### Design

1. **`resolveTenant` bleibt SYNCHRON.** Es ist ein nicht-awaiteter Hot-Path (`requestTenant`/
   `requireTenant`). KEIN invasiver async-Umbau. Statt der skalaren `tenant.idp_subject`-Suche
   konsultiert es einen **sub->tenantId-Index** (In-Memory-Map im State).
2. **pg fuellt den Index:**
   - bei `init()` aus `SELECT sub, tenant_id FROM account` (RLS-exempt lesen, wie der bestehende
     Spiegel-Aufbau).
   - beim **Nach-Boot-Web-Login** ueber `mintSession`: der vorhandene `ensureTenant(tenantId)`-Aufruf
     wird um eine `bindSubToTenant(sub, tenantId)`-Spiegel-Mutation ergaenzt. Das schliesst die
     "idp_subject eingefroren"-Landmine (heute refresht `ensureTenant` nur `status`).
3. **json fuellt den Index** aus `tenant.idpSubject` (unter json ist sub->Tenant 1:1, es gibt kein
   account) — byte-identisch zu heute. Der Parity-Test zwischen json und pg bleibt gruen.
4. **Onboard-Pfad (operator-only):** vor `registerTenant` ein `resolveTenant(sub)`-Check, damit der
   Operator keinen Zweit-Tenant fuer einen bereits gemergten sub anlegt.

### Invarianten / Pre-Mortem

- Der Index ist EINE Datenquelle fuer die sub->Tenant-Aufloesung (keine Doppel-Wahrheit
  neben `idp_subject`, die divergieren koennte). Wo `idp_subject` noch als Fallback dient, muss der
  Index Vorrang haben oder `idp_subject` als reine Anzeigespalte klar bleiben.
- Fail-closed: unbekannter sub -> kein Tenant (heutiges Ablehnungsverhalten bleibt).
- json/pg-Parity: der Parity-Test darf nicht kippen; unter json aendert sich nichts.
- Kein Race: nach Merge in Phase A + Nach-Boot-Bind muss `resolveTenant(sub2)` sofort den
  kanonischen Tenant liefern (nicht erst nach Neustart).

### Tests (neues Verhalten braucht Test)

- **Kanonische Aufloesung:** nach Merge (sub2 haengt via account auf `t_<sub1>`) liefert
  `resolveTenant(sub2)` denselben Tenant wie `resolveTenant(sub1)`.
- **Nach-Boot-Bind:** ein sub, der erst nach `init()` per Login gebunden wird, ist ohne Neustart
  aufloesbar (Landmine geschlossen).
- **Parity:** json und pg liefern fuer den 1:1-Fall dasselbe Ergebnis (bestehender Parity-Test bleibt
  gruen).
- **Onboard-Guard:** Operator-Onboard fuer einen bereits gemergten sub legt keinen Zweit-Tenant an.

### Deterministisch pruefbares Ergebnis

- `npm test` gruen (json + pglite), inkl. resolve-tenant + parity.
- `node --check` auf jede geaenderte .js-Datei.
