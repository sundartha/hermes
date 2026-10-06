import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore, BOOTSTRAP_TENANT_ID } from "./pg-helpers.js";
import { makeAccounts } from "../src/web-auth.js";
import { registerTenant } from "../src/store/state-ops.js";
import { tenantIdForSubject } from "../src/store/defaults.js";

const SUB = "sub-p6";
const TENANT = tenantIdForSubject(SUB);
const accountsOn = (db) =>
  makeAccounts({ withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (s) => db.exec(s) }) });

test("Flush hebt einen frischen suspended-Tenant NICHT auf active (Clobber)", async () => {
  const { store, db } = await makePgTestStore();
  const accounts = accountsOn(db);
  await accounts.upsertOnFirstLogin({ sub: SUB, email: "p6@kunde.de" });
  registerTenant(store.load(), TENANT, { idpSubject: SUB, firstName: "P6" });
  await store.save();
  assert.equal((await accounts.resolve(SUB)).status, "suspended");
});

test("Owner/Bootstrap bleibt nach migrate active (kein Lockout)", async () => {
  const { db } = await makePgTestStore();
  const r = await db.query(`SELECT status FROM tenant WHERE id=$1`, [BOOTSTRAP_TENANT_ID]);
  assert.equal(r.rows[0].status, "active");
});

test("Flush degradiert einen aktiven Tenant NICHT", async () => {
  const { store, db } = await makePgTestStore();
  const accounts = accountsOn(db);
  await accounts.upsertOnFirstLogin({ sub: SUB, email: "p6@kunde.de" });
  await accounts.setStatus(TENANT, "active");
  const t = registerTenant(store.load(), TENANT, { idpSubject: SUB });
  t.status = "suspended";
  await store.save();
  assert.equal((await accounts.resolve(SUB)).status, "active");
});

test("Flush reaktiviert einen geschlossenen Tenant NICHT", async () => {
  const { store, db } = await makePgTestStore();
  const accounts = accountsOn(db);
  await accounts.upsertOnFirstLogin({ sub: SUB, email: "p6@kunde.de" });
  await accounts.setStatus(TENANT, "closed");
  registerTenant(store.load(), TENANT, { idpSubject: SUB });
  await store.save();
  assert.equal((await accounts.resolve(SUB)).status, "closed");
});
