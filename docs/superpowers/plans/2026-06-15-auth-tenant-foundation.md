# Auth + Tenant-Foundation (Sub-Projekt B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den vodafone-agent von owner-only auf ein per-Request tenant-isoliertes Multi-Tenant-Fundament heben — mit beweisbarer Isolation, Browser-Login, Audit-Log, Session-Invalidierung und CASCADE-Loeschung — ohne die Agent-/Telefonie-Runtime anzufassen.

**Architecture:** Zwei-Pfad-Architektur. Der bestehende synchrone Owner-Spiegel-Store (`src/store.js` + `src/store/pg.js`) bleibt unveraendert (Agent/Operator-Runtime). NEU: ein async, per-Request, RLS-wrapped `portalStore`-Modul fuer Kunden-Reads (eigener pg-Pool, `SET LOCAL app.current_tenant` pro Transaktion = erzwungener Wrapper). Browser-Login als standard OIDC Authorization-Code + PKCE in-house (kein Provider-SDK), Issuer = WorkOS AuthKit (per `OAUTH_ISSUER_URL` swap-bar). Session serverseitig in pg, signiertes httpOnly-Cookie.

**Tech Stack:** Node ESM, Express 4, `pg` 8, `jose` 6 (vorhanden), `crypto` (in-house Cookie-Signatur + PKCE), `@electric-sql/pglite` (Tests), `node:test`. KEINE neuen Dependencies.

**Spec:** `docs/superpowers/specs/2026-06-15-auth-tenant-foundation-design.md`
**Council:** `~/Larry/drafts/2026-06-15_council_auth-tenant-foundation.md`

---

## Absolute Regeln (gelten in JEDER Task)

- Safety-Gates (`ALLOWED_NUMBERS`, `MAX_BUDGET_EUR`, Max-Dauer, Twilio-Signatur) nie aufweichen.
- `place_call`/`onboard` bleiben owner-only; `PROVISIONING_ENABLED` bleibt `false`. Kunden-web-auth = READ-only.
- AUTH fail-closed; Credential-/Token-Vergleiche via `safeEqual` (`src/util.js`).
- Secrets nur via env (`config.js`), nie loggen/leaken.
- Kommentare Deutsch ohne Umlaute (ue/oe/ae), wie im Bestand.
- Nach jedem Edit: `node --check <datei>` + `npm test`. Bei Funktions-Aenderungen alle Caller grep'en.
- `bridge.js` NICHT anfassen (HEIKLE STELLE).

---

## File Structure

| Datei | Verantwortung | Art |
|---|---|---|
| `src/store/portal.js` | async per-Request tenant-scoped Read-Modul + `withTenant`-Wrapper | Create |
| `src/portal-pool.js` | pg-Pool-Konstruktion fuer portalStore (DIP, wie `createPgBackend`) | Create |
| `src/db/schema.sql` | + `account`, `session`, `audit_log` Tabellen + RLS + CASCADE-Verifikation | Modify |
| `src/db/migrate.js` | neue Tabellen werden durch `applySchema` mitgezogen (kein Code-Change noetig); ggf. Seeding-Anpassung | Modify (ggf.) |
| `src/web-auth.js` | OIDC Auth-Code+PKCE Login/Callback/Logout, Session-Cookie, `webAuth`-Middleware, Admin-Gate | Create |
| `src/audit-store.js` | append-only `audit_log`-Insert (privilegierter Pfad) | Create |
| `src/config.js` | + `sessionSecret`, `adminEmails`, `loginRateLimitPerMin`, OIDC-Client-Felder | Modify |
| `src/server.js` | Login-Routen mounten, Kunden-`/api/*` ueber portalStore, Admin-Endpunkte, Session-Invalidierung-Hook | Modify |
| `.env.example`, `render.yaml` | neue Env-Variablen dokumentieren | Modify |
| `test/portal-rls-killer.test.js` | Isolation + Error-Injection (pglite, CI) | Create |
| `test/web-auth.test.js` | Login-Flow + Session + fail-closed (offline IdP) | Create |
| `test/admin-approval.test.js` | Approve/Suspend + Session-Invalidierung + Audit | Create |
| `docs/RELEASE-GATE-killer-test.md` | manueller Killer-Test gegen echtes Postgres+pgBouncer | Create |
| `PLAN-SECURITY.md` | Phase B dokumentieren | Modify |

---

## Phase 1 — Beweisen, dann bauen: portalStore + erzwungener RLS-Wrapper

> **Gate (Council Blocker #1):** Diese Phase muss komplett gruen sein, BEVOR Login/Feature-Code beginnt.

### Task 1: `withTenant`-Wrapper + portalStore-Skelett (RED)

**Files:**
- Create: `src/store/portal.js`
- Test: `test/portal-rls-killer.test.js`

- [ ] **Step 1: Failing test — Cross-Tenant-Read liefert leer**

`test/portal-rls-killer.test.js`:
```js
// portalStore: per-Request tenant-isolierte Reads. pglite laeuft als Superuser
// (umgeht RLS) -> wie store-pg-rls.test.js per SET ROLE auf eine unprivilegierte
// Rolle wechseln, damit die Policy wie im Betrieb greift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { applySchema, seedDefaults } from "../src/db/migrate.js";
import { makePortalStore } from "../src/store/portal.js";
import { OWNER_TENANT_ID } from "../src/store/defaults.js";
import { config } from "../src/config.js";

config.twilioNumber = ""; config.telnyxNumber = ""; // env-unabhaengig (wie store-pg-rls)

const APP_ROLE = "app_user";
const TENANT_A = "tenant_a", TENANT_B = "tenant_b";

async function setup() {
  const db = new PGlite();
  const exec = (sql) => db.exec(sql);
  const query = (t, p) => db.query(t, p);
  await applySchema({ query, exec });
  // GUC vor Seed (FORCE-RLS WITH-CHECK), wie init() es macht.
  await query(`SELECT set_config('app.current_tenant', $1, false)`, [OWNER_TENANT_ID]);
  await seedDefaults({ query, exec }, OWNER_TENANT_ID);
  for (const t of [TENANT_A, TENANT_B]) {
    await query(`INSERT INTO tenant (id) VALUES ($1) ON CONFLICT DO NOTHING`, [t]);
    await query(
      `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
       VALUES ($1, $2, 'tok', 'inbound', 'active', now()::text)`,
      [`call_${t}`, t]
    );
  }
  await db.exec(
    `CREATE ROLE ${APP_ROLE} NOLOGIN NOBYPASSRLS;
     GRANT SELECT, INSERT, UPDATE, DELETE ON call, transcript_segment, profile, settings,
       action_item, calendar_event, usage, notification, number TO ${APP_ROLE};
     GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`
  );
  return db;
}

// runner, der pro withTenant SET ROLE setzt (simuliert die unprivilegierte
// Produktionsrolle auf der einen pglite-Verbindung).
function roleRunner(db) {
  return {
    withClient: async (fn) => {
      await db.query(`SET ROLE ${APP_ROLE}`);
      try { return await fn({ query: (t, p) => db.query(t, p) }); }
      finally { await db.query(`RESET ROLE`); }
    },
  };
}

test("portalStore: Tenant A sieht nur eigene Calls", async () => {
  const db = await setup();
  const portal = makePortalStore(roleRunner(db));
  const rows = await portal.listCalls(TENANT_A);
  assert.deepEqual(rows.map((r) => r.id), ["call_tenant_a"]);
  assert.ok(!rows.some((r) => r.id === "call_tenant_b"), "fremder Call unsichtbar");
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `node --test test/portal-rls-killer.test.js`
Expected: FAIL — `makePortalStore` not found.

- [ ] **Step 3: Minimal `portal.js`**

`src/store/portal.js`:
```js
// portalStore: per-Request, tenant-scopetes Read-Modul fuer den Kunden-Web-Pfad.
// Trennscharf vom synchronen Owner-Spiegel (store.js): eigener async Pfad, der pro
// Request EINE Transaktion mit gesetzter RLS-GUC (SET LOCAL) faehrt. Der einzige
// Weg an einen DB-Client ist withTenant() -> kein Query ohne vorheriges SET LOCAL
// (erzwungener Wrapper, Council Blocker #1). KEINE Pool-Konstruktion hier (DIP):
// der runner.withClient wird injiziert (portal-pool.js im Betrieb, pglite im Test).
export function makePortalStore(runner) {
  // Faehrt fn(client) in EINER Transaktion mit transaktionslokaler RLS-GUC. SET
  // LOCAL ist txn-scoped -> nach COMMIT/ROLLBACK auf der gepoolten Verbindung weg
  // (pgBouncer-Transaction-Pooling-sicher). Jeder Fehler -> ROLLBACK, GUC faellt.
  async function withTenant(tenantId, fn) {
    if (!tenantId) throw new Error("withTenant: tenantId Pflicht (fail-closed)");
    return runner.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
        const out = await fn(client);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    });
  }

  return {
    withTenant,
    listCalls: (tenantId) =>
      withTenant(tenantId, async (c) =>
        (await c.query(`SELECT id, direction, status, started_at, summary FROM call ORDER BY seq DESC`)).rows
      ),
  };
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `node --test test/portal-rls-killer.test.js`
Expected: PASS.

- [ ] **Step 5: `node --check` + commit**

```bash
node --check src/store/portal.js
git add src/store/portal.js test/portal-rls-killer.test.js
git commit -m "feat(portal): per-Request tenant-scoped portalStore mit erzwungenem withTenant-Wrapper"
```

### Task 2: Negativ-Beweis — fremder Tenant + Transkript-Leak-Schutz

**Files:**
- Modify: `test/portal-rls-killer.test.js`

- [ ] **Step 1: Failing tests — Leak-Schutz + leerer Tenant**

Anhaengen in `test/portal-rls-killer.test.js`:
```js
test("portalStore: Tenant B sieht NUR call_tenant_b, nicht call_tenant_a", async () => {
  const db = await setup();
  const portal = makePortalStore(roleRunner(db));
  const rows = await portal.listCalls(TENANT_B);
  assert.deepEqual(rows.map((r) => r.id), ["call_tenant_b"]);
});

test("portalStore: frischer Tenant ist leer (kein Owner-Leak)", async () => {
  const db = await setup();
  await db.query(`INSERT INTO tenant (id) VALUES ('tenant_fresh') ON CONFLICT DO NOTHING`);
  const portal = makePortalStore(roleRunner(db));
  const rows = await portal.listCalls("tenant_fresh");
  assert.equal(rows.length, 0, "leerer Tenant sieht nichts vom Owner/anderen");
});

test("portalStore: Transkript-Read ist tenant-isoliert (Leak-Schutz)", async () => {
  const db = await setup();
  // Geheim-Transkript fuer Tenant A, als Superuser eingefuegt (Setup).
  await db.query(
    `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at)
     VALUES ('call_tenant_a', $1, 'caller', 'GEHEIM_A', now()::text)`, [TENANT_A]
  );
  const portal = makePortalStore(roleRunner(db));
  const texts = await portal.withTenant(TENANT_B, async (c) =>
    (await c.query(`SELECT text FROM transcript_segment`)).rows.map((r) => r.text)
  );
  assert.ok(!texts.join(" ").includes("GEHEIM_A"), "Tenant B sieht A-Transkript nicht");
});
```

- [ ] **Step 2: Run — verify it passes** (portalStore deckt das bereits ab)

Run: `node --test test/portal-rls-killer.test.js`
Expected: PASS (alle 4 Tests).

- [ ] **Step 3: Commit**

```bash
git add test/portal-rls-killer.test.js
git commit -m "test(portal): Negativ-Beweis Cross-Tenant-Leak + leerer Tenant"
```

### Task 3: Error-Injection — abgebrochene Txn leakt GUC nicht auf die naechste

**Files:**
- Modify: `test/portal-rls-killer.test.js`

- [ ] **Step 1: Failing test — nach ROLLBACK kein GUC-Reststand**

```js
test("portalStore: Query-Fehler in withTenant -> ROLLBACK, naechster Request sauber isoliert", async () => {
  const db = await setup();
  const portal = makePortalStore(roleRunner(db));
  // Request 1 (Tenant A) wirft mitten in der Txn -> ROLLBACK.
  await assert.rejects(
    () => portal.withTenant(TENANT_A, async (c) => {
      await c.query(`SELECT 1`);
      await c.query(`SELECT * FROM does_not_exist`); // Fehler -> ROLLBACK
    }),
    /does_not_exist|relation/i
  );
  // Request 2 (Tenant B) auf derselben Verbindung darf NUR B sehen.
  const rows = await portal.listCalls(TENANT_B);
  assert.deepEqual(rows.map((r) => r.id), ["call_tenant_b"], "kein GUC-Leak von A nach B");
});
```

- [ ] **Step 2: Run — verify it passes**

Run: `node --test test/portal-rls-killer.test.js`
Expected: PASS. (SET LOCAL + BEGIN/ROLLBACK garantieren, dass die GUC die Txn nicht ueberlebt.)

- [ ] **Step 3: Commit**

```bash
git add test/portal-rls-killer.test.js
git commit -m "test(portal): Error-Injection beweist GUC faellt bei ROLLBACK (kein Cross-Request-Leak)"
```

### Task 4: portalStore-Pool (Betriebs-Verdrahtung, non-superuser-Rolle)

**Files:**
- Create: `src/portal-pool.js`

- [ ] **Step 1: Pool-Runner (DIP, wie createPgBackend)**

`src/portal-pool.js`:
```js
// Betriebs-Verdrahtung fuer portalStore: ein eigener pg-Pool. Getrennt vom
// Owner-Spiegel-Pool, weil der Kunden-Pfad pro Request eine kurze Transaktion
// (BEGIN/SET LOCAL/COMMIT) faehrt - eigener Lebenszyklus, eigene Saettigung.
// WICHTIG (Produktion): der DATABASE_URL-Nutzer MUSS non-superuser + NOBYPASSRLS
// sein, sonst greift FORCE-RLS NICHT (Superuser umgeht RLS). Siehe
// docs/RELEASE-GATE-killer-test.md.
import pg from "pg";
import { config } from "./config.js";

export function createPortalRunner() {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  return {
    withClient: async (fn) => {
      const client = await pool.connect();
      try { return await fn({ query: (t, p) => client.query(t, p) }); }
      finally { client.release(); }
    },
    _pool: pool,
  };
}
```

- [ ] **Step 2: `node --check` + commit**

```bash
node --check src/portal-pool.js
git add src/portal-pool.js
git commit -m "feat(portal): eigener pg-Pool-Runner fuer den Kunden-Pfad (DIP)"
```

### Task 5: Release-Gate-Dokument — echter Killer-Test gegen Postgres + pgBouncer

**Files:**
- Create: `docs/RELEASE-GATE-killer-test.md`

- [ ] **Step 1: Manuelles Gate dokumentieren (pglite kann Pooling NICHT beweisen)**

`docs/RELEASE-GATE-killer-test.md`:
```markdown
# Release-Gate: Killer-Test (Tenant-Isolation unter echtem Connection-Pooling)

pglite ist single-connection und kann pgBouncer Transaction-Pooling NICHT
reproduzieren. Der CI-Test (test/portal-rls-killer.test.js) beweist Isolation +
GUC-Reset-bei-ROLLBACK auf einer Verbindung. Vor jedem Production-Deploy zusaetzlich
dieses Gate gegen die REALE Render-Topologie (Postgres + pgBouncer transaction mode):

## Vorbedingungen
- DB-Nutzer aus DATABASE_URL ist NON-SUPERUSER und NOBYPASSRLS (sonst greift RLS nicht).
- pgBouncer im `pool_mode = transaction`.

## Prozedur
1. Zwei Tenants mit je eigener call/transcript-Zeile seeden.
2. 50 parallele Requests, abwechselnd Tenant A/B, ueber portalStore.withTenant.
3. An zufaelligen Stellen einen Query-Fehler injizieren (Txn-Abbruch ohne sauberen Reset).
4. Assert: in KEINER Antwort taucht ein tenant_id der jeweils anderen Seite auf.

## Akzeptanz
100% sauber. Ein einziger Cross-Tenant-Treffer -> Deploy blockiert, Fundament neu bewerten.
```

- [ ] **Step 2: Commit**

```bash
git add docs/RELEASE-GATE-killer-test.md
git commit -m "docs(portal): Release-Gate fuer echten Killer-Test (pgBouncer transaction mode)"
```

---

## Phase 2 — Schema: account / session / audit_log + CASCADE

### Task 6: Schema-Erweiterung + RLS + CASCADE

**Files:**
- Modify: `src/db/schema.sql`
- Test: `test/schema-foundation.test.js` (Create)

- [ ] **Step 1: Failing test — neue Tabellen + CASCADE + audit ueberdauert**

`test/schema-foundation.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { applySchema } from "../src/db/migrate.js";

async function freshDb() {
  const db = new PGlite();
  await applySchema({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) });
  return db;
}

test("account/session/audit_log existieren", async () => {
  const db = await freshDb();
  for (const t of ["account", "session", "audit_log"]) {
    const r = await db.query(`SELECT to_regclass($1) AS x`, [t]);
    assert.ok(r.rows[0].x, `${t} fehlt`);
  }
});

test("CASCADE: tenant-Loeschung entfernt account/session, NICHT audit_log", async () => {
  const db = await freshDb();
  await db.query(`INSERT INTO tenant (id) VALUES ('t1')`);
  await db.query(`INSERT INTO account (sub, email, tenant_id) VALUES ('s1','a@x','t1')`);
  await db.query(`INSERT INTO session (id, sub, tenant_id, expires_at) VALUES ('sess1','s1','t1', now()+interval '1h')`);
  await db.query(`INSERT INTO audit_log (tenant_id, action) VALUES ('t1','tenant_create')`);
  await db.query(`DELETE FROM tenant WHERE id='t1'`);
  assert.equal((await db.query(`SELECT 1 FROM account`)).rows.length, 0, "account cascaded");
  assert.equal((await db.query(`SELECT 1 FROM session`)).rows.length, 0, "session cascaded");
  assert.equal((await db.query(`SELECT 1 FROM audit_log`)).rows.length, 1, "audit_log ueberdauert (compliance)");
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `node --test test/schema-foundation.test.js`
Expected: FAIL — Tabellen fehlen.

- [ ] **Step 3: Schema ergaenzen**

Ans Ende von `src/db/schema.sql` (vor den RLS-Bloecken, account/session bekommen RLS; audit_log NICHT — append-only, ueberdauert Loeschung). `account` ist RLS-EXEMPT (Resolver laeuft vor gesetzter GUC):
```sql
-- account: identity(sub)->tenant Resolver. RLS-EXEMPT (laeuft VOR app.current_tenant).
-- tenant_id NICHT unique -> Schema traegt spaeter mehrere Accounts pro Tenant (B2B),
-- jetzt aber Single-User pro Tenant (B2C). role: member|admin.
CREATE TABLE IF NOT EXISTS account (
  sub        TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  tenant_id  TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- session: serverseitige Sessions fuer Invalidierung (Suspend killt Session sofort).
CREATE TABLE IF NOT EXISTS session (
  id             TEXT PRIMARY KEY,
  sub            TEXT NOT NULL REFERENCES account(sub) ON DELETE CASCADE,
  tenant_id      TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  invalidated_at TIMESTAMPTZ
);

-- audit_log: immutable append-only. tenant_id BEWUSST KEIN FK (muss Tenant-
-- Loeschung ueberdauern, Compliance Art. 15). Keine RLS (privilegierter Insert-Pfad).
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_sub  TEXT,
  tenant_id  TEXT,
  action     TEXT NOT NULL,
  detail     TEXT
);
```

- [ ] **Step 4: Run — verify it passes**

Run: `node --test test/schema-foundation.test.js`
Expected: PASS.

- [ ] **Step 5: Volle Suite + commit**

```bash
npm test
git add src/db/schema.sql test/schema-foundation.test.js
git commit -m "feat(db): account/session/audit_log Tabellen + CASCADE (audit ueberdauert Loeschung)"
```

### Task 7: tenant.status-Transition + Audit-Store

**Files:**
- Create: `src/audit-store.js`
- Test: `test/audit-store.test.js` (Create)

- [ ] **Step 1: Failing test — append-only Audit-Insert**

`test/audit-store.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { applySchema } from "../src/db/migrate.js";
import { makeAuditStore } from "../src/audit-store.js";

test("auditStore.record schreibt eine Zeile (keine Secrets im detail)", async () => {
  const db = new PGlite();
  await applySchema({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) });
  const audit = makeAuditStore({ withClient: (fn) => fn({ query: (t, p) => db.query(t, p) }) });
  await audit.record({ actorSub: "admin1", tenantId: "t1", action: "tenant_approve", detail: "via=admin-endpoint" });
  const rows = (await db.query(`SELECT actor_sub, action, tenant_id FROM audit_log`)).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "tenant_approve");
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `node --test test/audit-store.test.js`
Expected: FAIL — `makeAuditStore` not found.

- [ ] **Step 3: `src/audit-store.js`**

```js
// Append-only Audit-Log-Schreiber. Eigener privilegierter Pfad (audit_log hat
// keine RLS). detail NIEMALS mit Secrets/Transkript-Inhalt fuellen.
export function makeAuditStore(runner) {
  return {
    record: ({ actorSub = null, tenantId = null, action, detail = null }) =>
      runner.withClient((c) =>
        c.query(
          `INSERT INTO audit_log (actor_sub, tenant_id, action, detail) VALUES ($1,$2,$3,$4)`,
          [actorSub, tenantId, action, detail]
        )
      ),
  };
}
```

- [ ] **Step 4: Run — verify it passes + commit**

```bash
node --test test/audit-store.test.js
node --check src/audit-store.js
git add src/audit-store.js test/audit-store.test.js
git commit -m "feat(audit): append-only audit_log-Schreiber"
```

---

## Phase 3 — Browser-Login: OIDC Auth-Code + PKCE + Session-Cookie (in-house)

### Task 8: PKCE + Cookie-Signatur-Helfer (in-house, kein neuer Dep)

**Files:**
- Create: `src/web-auth.js` (Teil 1: Krypto-Helfer)
- Test: `test/web-auth.test.js` (Create)

- [ ] **Step 1: Failing test — Cookie-Signatur round-trips, Manipulation faellt**

`test/web-auth.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { signValue, verifyValue, makePkce } from "../src/web-auth.js";

const SECRET = "test-session-secret-0123456789";

test("signValue/verifyValue round-trip + Manipulation -> null", () => {
  const signed = signValue("sess123", SECRET);
  assert.equal(verifyValue(signed, SECRET), "sess123");
  assert.equal(verifyValue(signed + "x", SECRET), null, "manipuliert -> null");
  assert.equal(verifyValue("garbage", SECRET), null);
});

test("makePkce liefert verifier + S256-challenge", () => {
  const { verifier, challenge } = makePkce();
  assert.ok(verifier.length >= 43 && challenge.length >= 43);
  assert.notEqual(verifier, challenge);
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `node --test test/web-auth.test.js`
Expected: FAIL — Modul/Exports fehlen.

- [ ] **Step 3: Krypto-Helfer in `src/web-auth.js`**

```js
// Browser-Login: standard OIDC Authorization-Code + PKCE, in-house (kein Provider-
// SDK -> kein Lock-in, nur OIDC-Claims queren die Schicht). Cookie-Signatur und
// PKCE mit crypto (kein neuer Dep). Niemals Tokens/Secrets loggen.
import crypto from "crypto";

const b64url = (buf) => buf.toString("base64url");

// HMAC-signierter Cookie-Wert "<value>.<sig>". Timing-sichere Pruefung.
export function signValue(value, secret) {
  const sig = crypto.createHmac("sha256", secret).update(value).digest("base64url");
  return `${value}.${sig}`;
}
export function verifyValue(signed, secret) {
  const i = String(signed).lastIndexOf(".");
  if (i < 1) return null;
  const value = signed.slice(0, i), sig = signed.slice(i + 1);
  const expected = crypto.createHmac("sha256", secret).update(value).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? value : null;
}

// PKCE S256.
export function makePkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}
```

- [ ] **Step 4: Run — verify it passes + commit**

```bash
node --test test/web-auth.test.js
node --check src/web-auth.js
git add src/web-auth.js test/web-auth.test.js
git commit -m "feat(web-auth): PKCE + HMAC-Cookie-Signatur (in-house, kein neuer Dep)"
```

### Task 9: Config-Felder + .env.example + render.yaml

**Files:**
- Modify: `src/config.js`, `.env.example`, `render.yaml`
- Test: `test/web-auth.test.js` (Config-Assertion ergaenzen)

- [ ] **Step 1: Config ergaenzen**

In `src/config.js` im `config`-Objekt (nach `oauthAudience`):
```js
  // ---- Web-Login (Kunden-Portal, OIDC Auth-Code + PKCE) ----
  // Session-Cookie-Signatur (HMAC). Secret -> nie loggen. Leer = Web-Login aus.
  sessionSecret: process.env.SESSION_SECRET || "",
  // OIDC-Client fuer den Browser-Flow (Issuer = config.oauthIssuerUrl, geteilt mit /mcp).
  oidcClientId: process.env.OIDC_CLIENT_ID || "",
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET || "", // SECRET
  // Admin-Allowlist (kommasepariert, E-Mails). Nur diese duerfen approve/suspend.
  adminEmails: (process.env.ADMIN_EMAILS || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
  // Strengeres Rate-Limit fuer Login/Callback (Brute-Force/Credential-Stuffing).
  loginRateLimitPerMin: parseInt(process.env.LOGIN_RATE_LIMIT_PER_MIN || "10", 10),
```

In `assertConfig()` ergaenzen:
```js
  if (config.storeBackend !== "pg" && config.sessionSecret)
    console.error("[Hinweis] Web-Login braucht STORE_BACKEND=pg (Sessions in der DB).");
```

- [ ] **Step 2: `.env.example` + `render.yaml` dokumentieren**

`.env.example` (neuer Block):
```
# ---- Web-Login (Kunden-Portal) ----
SESSION_SECRET=            # HMAC-Secret fuer Session-Cookies (langer Zufallswert)
OIDC_CLIENT_ID=            # WorkOS AuthKit Client-ID
OIDC_CLIENT_SECRET=        # WorkOS AuthKit Client-Secret (SECRET)
ADMIN_EMAILS=              # kommasepariert: wer approven/suspenden darf
LOGIN_RATE_LIMIT_PER_MIN=10
# OAUTH_ISSUER_URL wird mit /mcp geteilt (WorkOS AuthKit Issuer)
```

`render.yaml`: dieselben Keys unter `envVars` als `sync: false` (Secret) bzw. mit Default ergaenzen (Muster der bestehenden Eintraege folgen).

- [ ] **Step 3: `node --check` + `npm test` + commit**

```bash
node --check src/config.js
npm test
git add src/config.js .env.example render.yaml
git commit -m "feat(config): Web-Login-Env (SESSION_SECRET, OIDC-Client, ADMIN_EMAILS, Login-Rate-Limit)"
```

### Task 10: Login-/Callback-/Logout-Routen + Session-Anlage + Tenant-on-signup

**Files:**
- Modify: `src/web-auth.js` (Routen-Factory), `src/server.js` (mounten)
- Test: `test/web-auth.test.js` (Flow gegen offline-IdP)

> Nutzt `startIdp` aus `test/helpers.js` (RS256, JWKS). Der IdP wird in diesem Task um Authorization- + Token-Endpoint erweitert (Step 1 zeigt die Erweiterung).

- [ ] **Step 1: Failing test — voller Auth-Code-Flow legt Session + Tenant an**

Ergaenze in `test/web-auth.test.js` einen Integrationstest, der `startServer` mit `STORE_BACKEND=pg` (DATABASE_URL auf eine Test-pglite via Helper) ODER — falls Subprozess+pglite zu schwer — die Routen-Factory `makeWebAuthRoutes` direkt gegen einen In-Memory-Fake-Resolver testet:
```js
import { makeWebAuthRoutes } from "../src/web-auth.js";
// Fake-deps: resolver (account upsert), audit, session-store, oidc (discovery+exchange).
test("callback: gueltiger code -> Session-Cookie + Tenant 'suspended' angelegt", async () => {
  const created = [];
  const deps = {
    secret: SECRET,
    oidc: {
      authorizeUrl: ({ challenge, state }) => `https://idp/authorize?state=${state}&cc=${challenge}`,
      exchange: async () => ({ claims: { sub: "user-1", email: "neu@kunde.de" } }),
    },
    accounts: { upsertOnFirstLogin: async ({ sub, email }) => { created.push({ sub, email }); return { tenantId: "t_user-1", status: "suspended", role: "member" }; } },
    sessions: { create: async ({ sub, tenantId }) => ({ id: `sess_${sub}` }) },
    audit: { record: async () => {} },
  };
  const routes = makeWebAuthRoutes(deps);
  // ... Express-Request/Response-Doubles: /auth/login setzt state+verifier-Cookie,
  // /auth/callback?code=..&state=.. exchange -> upsert -> session -> Set-Cookie.
  // Assert: Set-Cookie enthaelt signierte Session-ID; created.length === 1.
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `node --test test/web-auth.test.js`
Expected: FAIL — `makeWebAuthRoutes` not found.

- [ ] **Step 3: Routen-Factory in `src/web-auth.js`**

Implementiere `makeWebAuthRoutes(deps)` -> liefert einen Express-Router mit:
- `GET /auth/login`: `makePkce()`, `state`=random; verifier+state als kurzlebige signierte httpOnly-Cookies setzen; redirect auf `deps.oidc.authorizeUrl({challenge,state,redirectUri})`.
- `GET /auth/callback`: state-Cookie vs query-state vergleichen (CSRF); `deps.oidc.exchange({code, verifier, redirectUri})` -> `{claims}`; `deps.accounts.upsertOnFirstLogin({sub, email})` -> `{tenantId, status, role}`; `deps.sessions.create(...)`; signiertes Session-Cookie (`signValue(session.id, secret)`, httpOnly, secure, sameSite=Lax) setzen; `deps.audit.record({actorSub:sub, tenantId, action:"login"})`; redirect `/`.
- `POST /auth/logout`: Session invalidieren + Cookie loeschen.

Vollstaendige Implementierung mit `signValue`/`verifyValue`/`makePkce`. KEINE Tokens loggen.

- [ ] **Step 4: OIDC-Adapter (discovery + exchange) anlegen**

In `src/web-auth.js` `makeOidc(config)`:
- `authorizeUrl` aus `<issuer>/.well-known/openid-configuration` (`authorization_endpoint`), Query: `response_type=code`, `client_id`, `redirect_uri=${config.publicUrl}/auth/callback`, `scope=openid email`, `code_challenge`, `code_challenge_method=S256`, `state`.
- `exchange`: POST `token_endpoint` (`grant_type=authorization_code`, `code`, `code_verifier`, `client_id`, `client_secret`, `redirect_uri`); `id_token` mit `jose.jwtVerify` gegen die (bereits in `auth.js` vorhandene) JWKS-Discovery pruefen -> `{claims:{sub,email}}`. Discovery-Cache wie `auth.js`.

- [ ] **Step 5: Session-Store + Account-Resolver (pg)**

`src/web-auth.js` `makeSessions(runner)` und `makeAccounts(runner)` (RLS-exempt, privilegierte Queries auf `account`/`session`):
- `accounts.upsertOnFirstLogin({sub,email})`: `INSERT INTO account ... ON CONFLICT (sub) DO UPDATE SET email=...` + Tenant anlegen falls neu (`INSERT INTO tenant (id, status) VALUES ($1,'suspended') ON CONFLICT DO NOTHING`, tenantId z.B. `t_${sub}`), Rueckgabe `{tenantId, status, role}`.
- `accounts.resolve(sub)`: join account+tenant -> `{tenantId, role, status, email}` (email fuer `adminOnly`).
- `sessions.create/get/invalidateByTenant`.

- [ ] **Step 6: In `server.js` mounten (VOR der Basic-Auth-Static-Schicht)**

`src/server.js`: nur wenn `config.sessionSecret` gesetzt: strengeren Login-Rate-Limiter (`createRateLimiter(config.loginRateLimitPerMin)`) auf `/auth/*` legen, dann `app.use(makeWebAuthRoutes(...))`. Reihenfolge beachten: `/auth/*` muss vor der `express.static` + Basic-Auth-Schicht erreichbar sein.

- [ ] **Step 7: Run + commit**

```bash
node --check src/web-auth.js && node --check src/server.js
npm test
git add src/web-auth.js src/server.js test/web-auth.test.js
git commit -m "feat(web-auth): OIDC Auth-Code+PKCE Login/Callback/Logout + Session + Tenant-on-signup"
```

---

## Phase 4 — webAuth-Middleware, Kunden-/api/*, Admin-Endpunkte, Session-Invalidierung

### Task 11: webAuth-Middleware (fail-closed, Session+Status-Pruefung)

**Files:**
- Modify: `src/web-auth.js` (`webAuth`-Middleware), `test/web-auth.test.js`

- [ ] **Step 1: Failing test — keine/abgelaufene/invalidierte Session -> 401; suspended -> 403**

Tests: Request ohne Cookie -> 401; mit Cookie aber `session.invalidated_at` gesetzt -> 401; gueltige Session aber `tenant.status='suspended'` -> 403; `active` -> `req.tenant` gesetzt, `next()`.

- [ ] **Step 2: Run — verify it fails**

Run: `node --test test/web-auth.test.js`
Expected: FAIL.

- [ ] **Step 3: `webAuth(deps)`-Middleware**

Liest signiertes Session-Cookie (`verifyValue`), laedt Session (`sessions.get`), prueft `invalidated_at IS NULL AND expires_at>now()` (sonst 401), `accounts.resolve(sub)` -> `status==='active'` (sonst 403, fail-closed), setzt `req.tenant = {tenantId, sub, role, email}` (email aus `account`, von `adminOnly` in Task 13 gebraucht), `next()`. Jeder Fehlpfad ohne Detail-Leak.

- [ ] **Step 4: Run + commit**

```bash
npm test
git add src/web-auth.js test/web-auth.test.js
git commit -m "feat(web-auth): webAuth-Middleware fail-closed (Session+Status, READ-Scope)"
```

### Task 12: Kunden-`GET /api/portal/state` ueber portalStore (tenant-scoped)

**Files:**
- Modify: `src/server.js`, `test/web-auth.test.js`

- [ ] **Step 1: Failing test — eingeloggter Kunde sieht nur eigene (leere) Daten**

Integrationstest (`startServer`, `STORE_BACKEND=pg`): Kunde A eingeloggt -> `GET /api/portal/state` liefert nur A's Calls (leer); niemals Owner-Daten. Ohne Session -> 401.

- [ ] **Step 2: Run — verify it fails**

Run: `node --test test/web-auth.test.js`
Expected: FAIL.

- [ ] **Step 3: Route in `server.js`**

```js
// Kunden-Portal-Read (READ-only, tenant-scoped ueber portalStore). webAuth setzt
// req.tenant; portalStore.withTenant erzwingt RLS. KEINE Owner-Daten (eigener Pfad).
app.get("/api/portal/state", webAuth, async (req, res) => {
  try {
    const calls = await portalStore.listCalls(req.tenant.tenantId);
    res.json({ tenantId: req.tenant.tenantId, calls });
  } catch (e) {
    console.error("[portal] state", e.message);
    res.status(500).json({ error: "interner Fehler" });
  }
});
```
`portalStore` wird beim Boot via `createPortalRunner()` konstruiert (nur wenn `storeBackend==='pg'`).

- [ ] **Step 4: Run + commit**

```bash
npm test
git add src/server.js test/web-auth.test.js
git commit -m "feat(portal): GET /api/portal/state tenant-scoped (READ-only, fail-closed)"
```

### Task 13: Admin Approve/Suspend + Session-Invalidierung + Audit

**Files:**
- Modify: `src/web-auth.js` (`adminOnly`), `src/server.js`
- Test: `test/admin-approval.test.js` (Create)

- [ ] **Step 1: Failing test — approve aktiviert; suspend invalidiert Sessions; non-admin 403; alles auditiert**

`test/admin-approval.test.js`: nur `ADMIN_EMAILS`-Identitaet darf `POST /api/admin/tenants/:id/approve` (status->active) und `/suspend` (status->suspended + alle Sessions `invalidated_at`); Nicht-Admin -> 403; jede Aktion erzeugt `audit_log`-Zeile; suspendeter Kunde -> naechster `/api/portal/state` 403.

- [ ] **Step 2: Run — verify it fails**

Run: `node --test test/admin-approval.test.js`
Expected: FAIL.

- [ ] **Step 3: `adminOnly`-Middleware + Routen**

`adminOnly`: nach `webAuth`, prueft `config.adminEmails.includes(req.tenant.email)` ODER `req.tenant.role==='admin'` (sonst 403). Routen:
```js
app.post("/api/admin/tenants/:id/approve", webAuth, adminOnly, async (req, res) => {
  await accounts.setStatus(req.params.id, "active");
  await audit.record({ actorSub: req.tenant.sub, tenantId: req.params.id, action: "tenant_approve" });
  res.json({ tenantId: req.params.id, status: "active" });
});
app.post("/api/admin/tenants/:id/suspend", webAuth, adminOnly, async (req, res) => {
  await accounts.setStatus(req.params.id, "suspended");
  await sessions.invalidateByTenant(req.params.id);
  await audit.record({ actorSub: req.tenant.sub, tenantId: req.params.id, action: "tenant_suspend" });
  res.json({ tenantId: req.params.id, status: "suspended" });
});
```
`accounts.setStatus` und `sessions.invalidateByTenant` in `web-auth.js` ergaenzen (privilegierte Queries). `req.tenant.email` muss webAuth mitliefern (aus `account`).

- [ ] **Step 4: Run + commit**

```bash
npm test
git add src/web-auth.js src/server.js test/admin-approval.test.js
git commit -m "feat(admin): approve/suspend + Session-Invalidierung + Audit (admin-allowlist, fail-closed)"
```

---

## Phase 5 — Definition of Done + Doku

### Task 14: fail-closed-Gesamttests + Owner-Pfad-Regression

**Files:**
- Modify: `test/web-auth.test.js`

- [ ] **Step 1: Tests — Owner-/Agent-Pfad unveraendert + Remote-nie-Owner**

- Bestehende `/api/state` (Owner, Basic-Auth) bleibt gruen (Regression: `npm test` der Altbestand-Suiten).
- `/api/portal/*` ohne Session immer 401.
- Remote-Request mit gefaelschtem `X-Internal-Identity` wird NICHT Owner (bestehende `internalIdentity`-Invariante; Test ergaenzen falls nicht abgedeckt).

- [ ] **Step 2: Run — ganze Suite**

Run: `npm test`
Expected: PASS (alle Suiten, inkl. Altbestand).

- [ ] **Step 3: Commit**

```bash
git add test/web-auth.test.js
git commit -m "test(foundation): fail-closed-Gesamtpruefung + Owner-Pfad-Regression"
```

### Task 15: PLAN-SECURITY.md fortschreiben + Self-Review

**Files:**
- Modify: `PLAN-SECURITY.md`

- [ ] **Step 1: Phase B dokumentieren**

In `PLAN-SECURITY.md`: Zwei-Pfad-Architektur, portalStore-RLS-Wrapper, account/session/audit_log, Web-Login (OIDC Auth-Code+PKCE, in-house), Admin-Allowlist, Session-Invalidierung, CASCADE-Loeschung. Neue bewusste Abweichung/Annahme: DATABASE_URL-Nutzer MUSS non-superuser+NOBYPASSRLS (sonst greift RLS nicht); pglite-CI-Test vs. echtes Killer-Test-Release-Gate.

- [ ] **Step 2: DoD-Checkliste abhaken**

- Killer-Test (CI: `portal-rls-killer.test.js`) gruen + Release-Gate-Doku vorhanden.
- Kein Request sieht Fremddaten (Isolations-Tests gruen).
- Login/Registrierung rate-limited (`loginRateLimitPerMin`).
- Session-Invalidierung getestet (suspend).
- CASCADE-Loeschung getestet (audit ueberdauert).
- fail-closed-Tests gruen.

- [ ] **Step 3: Commit**

```bash
git add PLAN-SECURITY.md
git commit -m "docs(security): Phase B (Auth+Tenant-Foundation) in PLAN-SECURITY.md"
```

---

## Offene Detail-Entscheidungen (im Execute zu finalisieren)

1. `audit_log` bei Tenant-Loeschung: anonymisieren (actor_sub/tenant_id) statt Zeile behalten? Spec §9 — Default: behalten (kein FK), Detail im Execute.
2. Tenant-ID-Schema: `t_${sub}` vs. eigener UUID. Default `t_${sub}` (deterministisch, debug-freundlich).
3. WorkOS AuthKit konkrete Client-/Redirect-Konfiguration (Dashboard-seitig, kein Code) — beim ersten echten Deploy.
