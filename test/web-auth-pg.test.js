// Integrationstest fuer makeAccounts/makeSessions gegen das ECHTE Schema (pglite).
// Die Router-Tests (web-auth.test.js) injizieren Fakes und ueben die echten
// SQL-Pfade NICHT aus - dieser Test faengt Tabellennamen-/Spalten-/SQL-Fehler
// (z.B. Singular tenant/account/session vs. Plural), die sonst erst zur Laufzeit
// unter STORE_BACKEND=pg auffliegen. account/tenant/session sind NICHT unter RLS
// (Resolver/Session-Pfad laeuft vor app.current_tenant) -> Superuser-Runner reicht.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { applySchema } from "../src/db/migrate.js";
import { makeAccounts, makeSessions } from "../src/web-auth.js";

async function setup() {
  const db = new PGlite();
  await applySchema({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) });
  const runner = { withClient: (fn) => fn({ query: (t, p) => db.query(t, p) }) };
  return { db, accounts: makeAccounts(runner), sessions: makeSessions(runner) };
}

test("makeAccounts.upsertOnFirstLogin legt Tenant(suspended)+Account an, idempotent", async () => {
  const { db, accounts } = await setup();
  const r1 = await accounts.upsertOnFirstLogin({ sub: "u1", email: "u1@x" });
  assert.deepEqual(r1, { tenantId: "t_u1", status: "suspended", role: "member" });
  // zweiter Login -> kein Duplikat
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "u1@x" });
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM account`)).rows[0].n, 1);
  assert.equal(
    (await db.query(`SELECT count(*)::int AS n FROM tenant WHERE id='t_u1'`)).rows[0].n,
    1,
  );
});

test("upsertOnFirstLogin setzt tenant.idp_subject=sub (Bruecke zu i9 resolveTenant, Identity-Dedup)", async () => {
  const { db, accounts } = await setup();
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "u1@x" });
  // i9 resolveTenant matcht tenant.idp_subject === sub -> ohne dieses Feld bleiben
  // Web-Login-Kanal (B) und MCP-Kanal (i9) disjunkt (resolveTenant liefert null).
  assert.equal(
    (await db.query(`SELECT idp_subject FROM tenant WHERE id='t_u1'`)).rows[0].idp_subject,
    "u1",
  );
  // Repeat-Login bleibt idempotent + ueberschreibt einen aktivierten Status NICHT.
  await accounts.setStatus("t_u1", "active");
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "u1@x" });
  assert.equal(
    (await db.query(`SELECT status FROM tenant WHERE id='t_u1'`)).rows[0].status,
    "active",
  );
});

test("makeAccounts.resolve liefert tenantId/role/status/email", async () => {
  const { accounts } = await setup();
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "u1@x" });
  const r = await accounts.resolve("u1");
  assert.equal(r.tenantId, "t_u1");
  assert.equal(r.role, "member");
  assert.equal(r.status, "suspended");
  assert.equal(r.email, "u1@x");
  assert.equal(await accounts.resolve("ghost"), null);
});

test("accountByTenant: genau 1 -> {sub,email}; 0 -> null; >1 (mehrdeutig) -> null", async () => {
  const { db, accounts } = await setup();
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "u1@x" });
  assert.deepEqual(await accounts.accountByTenant("t_u1"), { sub: "u1", email: "u1@x" });
  // 0 Accounts (Webhook vor Account-Anlage) -> fail-closed null.
  assert.equal(await accounts.accountByTenant("t_ghost"), null);
  // Zweiter Account auf denselben tenant_id (account.tenant_id ist FK, NICHT unique) ->
  // mehrdeutig -> fail-closed null (§5.6 B2C-1:1, NICHT raten).
  await accounts.upsertOnFirstLogin({ sub: "u2", email: "u2@x" }); // legt t_u2 an
  await db.query(`UPDATE account SET tenant_id = 't_u1' WHERE sub = 'u2'`);
  assert.equal(await accounts.accountByTenant("t_u1"), null);
});

test("makeAccounts.setStatus aktiviert; upsert liest aktuellen Status zurueck (nicht hartkodiert)", async () => {
  const { accounts } = await setup();
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "u1@x" });
  await accounts.setStatus("t_u1", "active");
  assert.equal((await accounts.resolve("u1")).status, "active");
  // Wiederkehrender Login eines bereits aktiven Tenants meldet 'active', nicht 'suspended'.
  const again = await accounts.upsertOnFirstLogin({ sub: "u1", email: "u1@x" });
  assert.equal(again.status, "active");
});

test("makeSessions.create+get gegen echtes Schema (invalidated_at NULL)", async () => {
  const { accounts, sessions } = await setup();
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "u1@x" });
  const { id } = await sessions.create({ sub: "u1", tenantId: "t_u1", ttlSeconds: 3600 });
  const row = await sessions.get(id);
  assert.equal(row.tenantId, "t_u1");
  assert.equal(row.sub, "u1");
  assert.equal(row.invalidated_at, null);
});

test("makeSessions.create+get roundtrips workos_session_id (WorkOS-Sign-out, P1)", async () => {
  const { accounts, sessions } = await setup();
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "u1@x" });
  const { id } = await sessions.create({
    sub: "u1",
    tenantId: "t_u1",
    ttlSeconds: 3600,
    workosSessionId: "workos_sess_abc",
  });
  assert.equal((await sessions.get(id)).workosSessionId, "workos_sess_abc");
});

test("makeSessions.create ohne workosSessionId -> NULL (Dev-Login/Alt-Pfad)", async () => {
  const { accounts, sessions } = await setup();
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "u1@x" });
  const { id } = await sessions.create({ sub: "u1", tenantId: "t_u1", ttlSeconds: 3600 });
  assert.equal((await sessions.get(id)).workosSessionId, null);
});

test("makeSessions.invalidateById setzt invalidated_at (Soft-Invalidierung)", async () => {
  const { accounts, sessions } = await setup();
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "u1@x" });
  const { id } = await sessions.create({ sub: "u1", tenantId: "t_u1", ttlSeconds: 3600 });
  await sessions.invalidateById(id);
  assert.notEqual((await sessions.get(id)).invalidated_at, null);
});

test("makeSessions.invalidateByTenant invalidiert alle aktiven Sessions des Tenants", async () => {
  const { accounts, sessions } = await setup();
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "u1@x" });
  const a = await sessions.create({ sub: "u1", tenantId: "t_u1", ttlSeconds: 3600 });
  const b = await sessions.create({ sub: "u1", tenantId: "t_u1", ttlSeconds: 3600 });
  await sessions.invalidateByTenant("t_u1");
  assert.notEqual((await sessions.get(a.id)).invalidated_at, null);
  assert.notEqual((await sessions.get(b.id)).invalidated_at, null);
});
