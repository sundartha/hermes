import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore } from "../src/store/pg.js";
import { makeAccounts } from "../src/web-auth.js";
import { backfillPlanProfiles, BACKFILL_SKIP } from "../src/billing/backfill-profiles.js";
import { KYC_LEVEL } from "../src/store/defaults.js";

function makeRunner(db) {
  return {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
}

async function openStore(runner) {
  const store = makePgStore(runner);
  await store.init();
  return store;
}

async function makeStoreAndAccounts() {
  const db = new PGlite();
  const runner = makeRunner(db);
  const store = await openStore(runner);
  return { db, store, accounts: makeAccounts(runner) };
}

async function reopen(db) {
  return openStore(makeRunner(db));
}

async function seedActiveSubscriber(store, accounts, { sub, email, planSlug, subscriptionId }) {
  const { tenantId } = await accounts.upsertOnFirstLogin({ sub, email });
  await accounts.setStatus(tenantId, "active");
  await store.ensureTenant(tenantId);
  store.setKycLevel(tenantId, KYC_LEVEL.CARD);
  if (planSlug || subscriptionId) store.setTenantSubscription(tenantId, { planSlug, subscriptionId });
  await store.save();
  return tenantId;
}

test("Dry-Run listet den Bestands-Subscriber, schreibt aber kein Profil", async () => {
  const { store, accounts } = await makeStoreAndAccounts();
  const tenantId = await seedActiveSubscriber(store, accounts, { sub: "u1", email: "u1@x", planSlug: "starter", subscriptionId: "sub_1" });
  const r = await backfillPlanProfiles({ store, apply: false });
  assert.deepEqual(r.changes, [{ id: tenantId, hadExisting: false }]);
  assert.equal(Object.keys(store.load().profiles).length, 0);
});

test("Apply provisioniert + persistiert das Tier-Profil (hydrate->flush->hydrate)", async () => {
  const { db, store, accounts } = await makeStoreAndAccounts();
  const tenantId = await seedActiveSubscriber(store, accounts, { sub: "u1", email: "u1@x", planSlug: "starter", subscriptionId: "sub_1" });

  const r = await backfillPlanProfiles({ store, apply: true });
  await store.save();
  assert.equal(r.changes.length, 1);
  assert.equal(store.resolveProfile(tenantId).maxCallsPerHour, null);

  const reopened = await reopen(db);
  assert.equal(reopened.resolveProfile(tenantId).unrestricted, false, "Profil round-trippt persistent");

  const r2 = await backfillPlanProfiles({ store: reopened, apply: true });
  assert.equal(r2.changes.length, 0);
  assert.equal(r2.unchanged.length, 1);
});

test("Bootstrap-Owner (im Spiegel, kein Plan) wird nie gebackfillt", async () => {
  const { store } = await makeStoreAndAccounts();
  const owner = store.load().tenants[0];
  const r = await backfillPlanProfiles({ store, apply: true });
  assert.ok(r.skipped.some((x) => x.id === owner.id && x.reason === BACKFILL_SKIP.BOOTSTRAP));
  assert.equal(Object.keys(store.load().profiles).length, 0);
});
