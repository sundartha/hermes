// Integrationstest fuer makeAccounts/makeSessions gegen das ECHTE Schema (pglite).
// Die Router-Tests (web-auth.test.js) injizieren Fakes und ueben die echten
// SQL-Pfade NICHT aus - dieser Test faengt Tabellennamen-/Spalten-/SQL-Fehler
// (z.B. Singular tenant/account/session vs. Plural), die sonst erst zur Laufzeit
// unter STORE_BACKEND=pg auffliegen. account/tenant/session sind NICHT unter RLS
// (Resolver/Session-Pfad laeuft vor app.current_tenant) -> Superuser-Runner reicht.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { applySchema, backfillAccountEmailCase } from "../src/db/migrate.js";
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

test("Phase tenant-prolif-a: zweiter verifizierter Login mit gleicher Email mergt auf denselben (aelteren) Tenant", async () => {
  const { db, accounts } = await setup();
  const r1 = await accounts.upsertOnFirstLogin({ sub: "u1", email: "shared@x" });
  const r2 = await accounts.upsertOnFirstLogin({ sub: "u2", email: "shared@x" });
  assert.equal(r1.tenantId, "t_u1");
  assert.equal(r2.tenantId, "t_u1"); // sub2 erbt sub1s Tenant, NICHT t_u2
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
  const r2 = await accounts.upsertOnFirstLogin({ sub: "u2", email: "b@x" }); // andere Email
  assert.equal(r1.tenantId, "t_u1");
  assert.equal(r2.tenantId, "t_u2"); // kein Merge
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
  // Fault-Injector: laesst BEGIN + Dedup-SELECT + Tenant-INSERT durch, wirft aber beim
  // account-INSERT -> upsertOnFirstLogin MUSS ROLLBACK fahren und den Tenant mit zuruecknehmen.
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

// ---- Review-Blocker Runde 1 ------------------------------------------

test("Review-Blocker Runde 1 (behaviorAsIntended): Rueckgabe-tenantId nach Repeat-Login MUSS accounts.resolve() (Autorisierung) entsprechen, auch bei Alt-Duplikat", async () => {
  const { db, accounts } = await setup();
  // Alt-Duplikat-Population simulieren (die eigentliche Zielgruppe der Phase, laut RCA
  // schon in Prod vorhanden): zwei Accounts mit unterschiedlichen Tenants existieren
  // BEREITS, bevor ihre Emails identisch werden. u1 zuerst -> aeltester Account, gewinnt
  // spaeter den Dedup-SELECT (ORDER BY created_at ASC).
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "shared@x" }); // legt t_u1 an (aelter)
  await accounts.upsertOnFirstLogin({ sub: "u2", email: "other@x" }); // legt t_u2 an (eigener Tenant)
  // u2s Email wird nachtraeglich identisch zu u1s (z.B. IdP-Merge) - u2 hat bereits einen
  // EIGENEN Tenant (t_u2), lange bevor die Dedup-Logik das erste Mal fuer diese Email laeuft.
  await db.query(`UPDATE account SET email = 'shared@x' WHERE sub = 'u2'`);

  // Repeat-Login von u2 (post-fix): resolveOrCreateTenant findet u1 (aelter) als Dedup-
  // Gewinner, ABER der ON-CONFLICT-Account-Upsert kippt u2s tenant_id NICHT (Invariante
  // "ein Repeat-Login darf die Tenant-Bindung nicht kippen", Kommentar bei INSERT INTO
  // account oben) - u2 bleibt auf t_u2. Die Rueckgabe von upsertOnFirstLogin MUSS exakt das
  // treffen, was accounts.resolve() (= req.tenant, die Autorisierungsquelle in webAuth)
  // danach liest - sonst bindet mintSession Session/ensureTenant/applyTenantIdentity an
  // einen ANDEREN Tenant als die Autorisierung.
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
  // Zwei echte simultane Postgres-Sessions lassen sich mit dem Single-Session-Test-Runner
  // dieser Datei (EINE PGlite-Instanz) nicht herstellen (PGlite kennt nur eine Session -
  // ein zweites BEGIN auf derselben Verbindung startet KEINE unabhaengige Transaktion,
  // das Lock-Statement wuerde also nie tatsaechlich blockieren und ein Race nicht sichtbar
  // machen). Dieser Test beweist stattdessen den VERTRAG, der das Race in echtem Postgres
  // schliesst: der Advisory-Lock auf der Email wird VOR dem Dedup-SELECT innerhalb derselben
  // Transaktion angefordert - pg_advisory_xact_lock() ist dokumentiertes, battle-getestetes
  // Postgres-Verhalten (blockiert konkurrierende Sessions mit demselben Schluessel bis
  // COMMIT/ROLLBACK), das hier nicht neu zu verifizieren ist.
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
  const selectIdx = calls.findIndex((c) => c.text.includes("SELECT tenant_id FROM account"));
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

// ---- Review-Blocker Runde 2 -------------------------------------------

test("Review-Blocker Runde 2 (G26): case-abweichende Schreibweise derselben Email dedupt trotzdem auf denselben (aeltesten) Tenant", async () => {
  const { db, accounts } = await setup();
  // Autofill-/Copy-Paste-Varianten derselben realen Adresse - VOR dem Fix matchte der
  // case-sensitive Dedup-SELECT das nicht und legte einen zweiten Tenant an.
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
  // Bestandszeile aus der Zeit VOR der Normalisierung: direkt eingefuegt (nicht ueber
  // upsertOnFirstLogin, das schon normalisiert) - simuliert uneinheitliche Prod-Altdaten.
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
  // Zweiter Lauf: WHERE-Filter trifft 0 Zeilen -> kein Drift (Idempotenz, Muster backfillPeriodStart).
  await backfillAccountEmailCase(migrateDb);
  assert.equal(
    (await db.query(`SELECT email FROM account WHERE sub = 'legacy'`)).rows[0].email,
    "legacy@x.de",
  );
});
