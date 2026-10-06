import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { applySchema, backfillAccountEmailCase } from "../src/db/migrate.js";
import { makeAccounts, makeSessions, newestAccountIfUnanimousEmail } from "../src/web-auth.js";

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
  assert.equal(
    (await db.query(`SELECT idp_subject FROM tenant WHERE id='t_u1'`)).rows[0].idp_subject,
    "u1",
  );
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
  assert.equal(await accounts.accountByTenant("t_ghost"), null);
  await accounts.upsertOnFirstLogin({ sub: "u2", email: "u2@x" });
  await db.query(`UPDATE account SET tenant_id = 't_u1' WHERE sub = 'u2'`);
  assert.equal(await accounts.accountByTenant("t_u1"), null);
});

test("newestAccountIfUnanimousEmail: [] -> null", () => {
  assert.equal(newestAccountIfUnanimousEmail([]), null);
});

test("newestAccountIfUnanimousEmail: eine Zeile -> sie selbst", () => {
  const rows = [{ sub: "u1", email: "u1@x" }];
  assert.deepEqual(newestAccountIfUnanimousEmail(rows), { sub: "u1", email: "u1@x" });
});

test("newestAccountIfUnanimousEmail: zwei Zeilen gleicher Email -> die erste (juengste)", () => {
  const rows = [
    { sub: "u2", email: "kunde@x" },
    { sub: "u1", email: "kunde@x" },
  ];
  assert.deepEqual(newestAccountIfUnanimousEmail(rows), { sub: "u2", email: "kunde@x" });
});

test("newestAccountIfUnanimousEmail: zwei Zeilen unterschiedlicher Email -> null", () => {
  const rows = [
    { sub: "u2", email: "u2@x" },
    { sub: "u1", email: "u1@x" },
  ];
  assert.equal(newestAccountIfUnanimousEmail(rows), null);
});

test("accountByTenant: zwei Zeilen gleicher Email auf demselben Tenant -> juengste (created_at) gewinnt", async () => {
  const { db, accounts } = await setup();
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "kunde@x" });
  await accounts.upsertOnFirstLogin({ sub: "u2", email: "kunde@x" });
  await db.query(`UPDATE account SET tenant_id = 't_u1' WHERE sub = 'u2'`);
  await db.query(`UPDATE account SET created_at = $1 WHERE sub = $2`, ["2026-01-01T00:00:00Z", "u1"]);
  await db.query(`UPDATE account SET created_at = $1 WHERE sub = $2`, ["2026-01-02T00:00:00Z", "u2"]);
  assert.deepEqual(await accounts.accountByTenant("t_u1"), { sub: "u2", email: "kunde@x" });
});

test("makeAccounts.setStatus aktiviert; upsert liest aktuellen Status zurueck (nicht hartkodiert)", async () => {
  const { accounts } = await setup();
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "u1@x" });
  await accounts.setStatus("t_u1", "active");
  assert.equal((await accounts.resolve("u1")).status, "active");
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

test("Phase tenant-prolif-a: zweiter verifizierter Login mit gleicher Email mergt auf denselben (aelteren) Tenant", async () => {
  const { db, accounts } = await setup();
  const r1 = await accounts.upsertOnFirstLogin({ sub: "u1", email: "shared@x" });
  const r2 = await accounts.upsertOnFirstLogin({ sub: "u2", email: "shared@x" });
  assert.equal(r1.tenantId, "t_u1");
  assert.equal(r2.tenantId, "t_u1");
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM tenant`)).rows[0].n, 1);
  assert.equal(
    (await db.query(`SELECT count(*)::int AS n FROM tenant WHERE id='t_u2'`)).rows[0].n,
    0,
  );
  assert.equal(
    (await db.query(`SELECT count(*)::int AS n FROM account WHERE email='shared@x'`)).rows[0].n,
    2,
  );
  assert.equal((await accounts.resolve("u1")).tenantId, "t_u1");
  assert.equal((await accounts.resolve("u2")).tenantId, "t_u1");
});

test("Phase tenant-prolif-a: neue verifizierte Email legt neuen Tenant an (Kein-Treffer, heutiges Verhalten)", async () => {
  const { db, accounts } = await setup();
  const r1 = await accounts.upsertOnFirstLogin({ sub: "u1", email: "a@x" });
  const r2 = await accounts.upsertOnFirstLogin({ sub: "u2", email: "b@x" });
  assert.equal(r1.tenantId, "t_u1");
  assert.equal(r2.tenantId, "t_u2");
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM tenant`)).rows[0].n, 2);
  assert.equal(
    (await db.query(`SELECT idp_subject FROM tenant WHERE id='t_u2'`)).rows[0].idp_subject,
    "u2",
  );
});

test("Phase tenant-prolif-a: unverifizierte/leere Email -> Reject, KEIN Tenant/Account (kein Orphan)", async () => {
  const { db, accounts } = await setup();
  await assert.rejects(() => accounts.upsertOnFirstLogin({ sub: "u1", email: null }));
  await assert.rejects(() => accounts.upsertOnFirstLogin({ sub: "u1", email: "" }));
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM tenant`)).rows[0].n, 0);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM account`)).rows[0].n, 0);
});

test("Phase tenant-prolif-a: Fehler beim Account-INSERT rollt den neuen Tenant zurueck (Transaktion, kein Orphan)", async () => {
  const { db } = await setup();
  const failingRunner = {
    withClient: (fn) =>
      fn({
        query: (t, p) => {
          if (typeof t === "string" && t.includes("INSERT INTO account"))
            throw new Error("injizierter Fehler");
          return db.query(t, p);
        },
      }),
  };
  const accounts = makeAccounts(failingRunner);
  await assert.rejects(() => accounts.upsertOnFirstLogin({ sub: "u1", email: "a@x" }));
  assert.equal(
    (await db.query(`SELECT count(*)::int AS n FROM tenant WHERE id='t_u1'`)).rows[0].n,
    0,
  );
});

test("Review-Blocker Runde 1 (behaviorAsIntended): Rueckgabe-tenantId nach Repeat-Login MUSS accounts.resolve() (Autorisierung) entsprechen, auch bei Alt-Duplikat", async () => {
  const { db, accounts } = await setup();
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "shared@x" });
  await accounts.upsertOnFirstLogin({ sub: "u2", email: "other@x" });
  await db.query(`UPDATE account SET email = 'shared@x' WHERE sub = 'u2'`);

  const repeat = await accounts.upsertOnFirstLogin({ sub: "u2", email: "shared@x" });
  const authz = await accounts.resolve("u2");

  assert.equal(
    repeat.tenantId,
    authz.tenantId,
    "Rueckgabe von upsertOnFirstLogin muss der Autorisierungsquelle (accounts.resolve) entsprechen",
  );
  assert.equal(repeat.tenantId, "t_u2", "Repeat-Login kippt die bestehende Tenant-Bindung NICHT");
});

test("Review-Blocker Runde 1 (P16/G26): resolveOrCreateTenant serialisiert ueber pg_advisory_xact_lock VOR dem Dedup-SELECT", async () => {
  const db = new PGlite();
  await applySchema({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) });
  const calls = [];
  const runner = {
    withClient: (fn) =>
      fn({
        query: (text, params) => {
          calls.push({ text, params });
          return db.query(text, params);
        },
      }),
  };
  const accounts = makeAccounts(runner);
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "shared@x" });

  const lockIdx = calls.findIndex((c) => c.text.includes("pg_advisory_xact_lock"));
  const selectIdx = calls.findIndex((c) => c.text.includes("SELECT a.tenant_id FROM account"));
  assert.ok(lockIdx >= 0, "Advisory-Lock-Statement fehlt");
  assert.ok(selectIdx >= 0, "Dedup-SELECT fehlt");
  assert.ok(
    lockIdx < selectIdx,
    "Lock muss VOR dem Dedup-SELECT laufen, sonst bleibt das Race-Fenster offen",
  );
  assert.deepEqual(
    calls[lockIdx].params,
    ["shared@x"],
    "Lock muss auf der EMAIL liegen (nicht sub/global), sonst ueber-/unterserialisiert er",
  );
});

test("Review-Blocker Runde 2 (G26): case-abweichende Schreibweise derselben Email dedupt trotzdem auf denselben (aeltesten) Tenant", async () => {
  const { db, accounts } = await setup();
  const r1 = await accounts.upsertOnFirstLogin({ sub: "u1", email: "Shared@Example.com" });
  const r2 = await accounts.upsertOnFirstLogin({ sub: "u2", email: "shared@example.com" });
  assert.equal(r1.tenantId, "t_u1");
  assert.equal(r2.tenantId, "t_u1", "Gross-/Kleinschreibung darf nicht als andere Email zaehlen");
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM tenant`)).rows[0].n, 1);
  assert.equal((await accounts.resolve("u2")).tenantId, "t_u1");
});

test("Review-Blocker Runde 2 (G26): account.email wird trim+lowercase persistiert (Speicherform = Vergleichsform)", async () => {
  const { db, accounts } = await setup();
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "  User@X.De  " });
  const row = await db.query(`SELECT email FROM account WHERE sub = 'u1'`);
  assert.equal(row.rows[0].email, "user@x.de");
});

test("Review-Blocker Runde 2 (G26): reine Whitespace-Email wird wie eine fehlende Email abgelehnt (kein Orphan-Tenant)", async () => {
  const { db, accounts } = await setup();
  await assert.rejects(() => accounts.upsertOnFirstLogin({ sub: "u1", email: "   " }));
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM tenant`)).rows[0].n, 0);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM account`)).rows[0].n, 0);
});

test("Review-Blocker Runde 2 (G26): backfillAccountEmailCase normalisiert Bestandszeilen idempotent (Migrations-Backfill)", async () => {
  const db = new PGlite();
  await applySchema({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) });
  await db.query(`INSERT INTO tenant (id, status) VALUES ('t_legacy', 'suspended')`);
  await db.query(
    `INSERT INTO account (sub, tenant_id, email, role) VALUES ('legacy', 't_legacy', 'Legacy@X.De', 'member')`,
  );
  const migrateDb = { query: (t, p) => db.query(t, p) };
  await backfillAccountEmailCase(migrateDb);
  assert.equal(
    (await db.query(`SELECT email FROM account WHERE sub = 'legacy'`)).rows[0].email,
    "legacy@x.de",
  );
  await backfillAccountEmailCase(migrateDb);
  assert.equal(
    (await db.query(`SELECT email FROM account WHERE sub = 'legacy'`)).rows[0].email,
    "legacy@x.de",
  );
});

test("Review-Blocker Runde 3 (G3/S1): aeltester Alt-Account ist closed -> neuer Tenant statt Merge-Falle", async () => {
  const { db, accounts } = await setup();
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "shared@x" });
  await db.query(`UPDATE tenant SET status = 'closed' WHERE id = 't_u1'`);

  const r2 = await accounts.upsertOnFirstLogin({ sub: "u2", email: "shared@x" });
  assert.equal(r2.tenantId, "t_u2", "closed-Tenant darf kein Merge-Ziel sein");
  assert.equal(r2.status, "suspended", "frischer Tenant startet suspended, nicht closed");
  assert.equal((await accounts.resolve("u2")).tenantId, "t_u2");
  assert.equal(
    (await db.query(`SELECT idp_subject FROM tenant WHERE id='t_u2'`)).rows[0].idp_subject,
    "u2",
  );
});

test("Review-Blocker Runde 3 (G3/S1): closed-Alt-Account wird uebersprungen, juengerer nicht-closed Alt-Account bleibt Merge-Ziel", async () => {
  const { db, accounts } = await setup();
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "shared@x" });
  await accounts.upsertOnFirstLogin({ sub: "u2", email: "other@x" });
  await db.query(`UPDATE account SET email = 'shared@x' WHERE sub = 'u2'`);
  await db.query(`UPDATE tenant SET status = 'closed' WHERE id = 't_u1'`);

  const r3 = await accounts.upsertOnFirstLogin({ sub: "u3", email: "shared@x" });
  assert.equal(
    r3.tenantId,
    "t_u2",
    "Dedup muss den aeltesten NICHT-closed Alt-Account treffen, nicht den closed und nicht neu anlegen",
  );
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM tenant`)).rows[0].n, 2);
});
