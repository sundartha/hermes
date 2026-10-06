import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
import { recordProvisioningJob } from "../src/store/state-ops.js";
import { PROVIDER } from "../src/store/defaults.js";
import { makePgTestStore } from "./pg-helpers.js";

async function reopen(db) {
  const store = makePgStore({
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  });
  await store.init();
  return store;
}

test("recordProvisioningJob setzt createdAt als kanonischen ISO-8601-String", () => {
  const s = { provisioningJobs: [] };
  const job = recordProvisioningJob(s, { numberId: "num_x", tenantId: "t1", idempotencyKey: "k1" });
  assert.equal(typeof job.createdAt, "string");
  assert.equal(job.createdAt, new Date(job.createdAt).toISOString());
});

test("recordProvisioningJob ist idempotent -> createdAt des Erst-Records bleibt", () => {
  const s = { provisioningJobs: [] };
  const a = recordProvisioningJob(s, { numberId: "num_x", tenantId: "t1", idempotencyKey: "k1" });
  const b = recordProvisioningJob(s, { numberId: "num_x", tenantId: "t1", idempotencyKey: "k1" });
  assert.equal(s.provisioningJobs.length, 1);
  assert.equal(b.createdAt, a.createdAt);
});

test("pg-Roundtrip erhaelt createdAt exakt (flush -> hydrate, TIMESTAMPTZ -> ISO)", async () => {
  const { store, db } = await makePgTestStore();
  const s = store.load();
  s.numbers.push({
    id: "num_x", e164: null, tenantId: BOOTSTRAP_TENANT_ID,
    provider: PROVIDER.TELNYX, status: "requested", providerNumberId: null,
  });
  const job = recordProvisioningJob(s, {
    numberId: "num_x", tenantId: BOOTSTRAP_TENANT_ID, idempotencyKey: "provision_num_x",
  });
  const created = job.createdAt;
  await store.save();
  const persisted = (await reopen(db)).load().provisioningJobs.find((j) => j.id === job.id);
  assert.ok(persisted, "Job ueberlebt Re-Hydrierung");
  assert.equal(persisted.createdAt, created, "createdAt exakt erhalten");
});
