// tenant-prolif-b: sub->Tenant ueber account (synchroner Spiegel-Index). Beweist den
// Merge-Fall aus Phase tenant-prolif-a (Email-Dedup): ein per Email gemergter Zweit-sub
// (account(sub2)->t_sub1, aber KEIN tenant.idpSubject===sub2) loest ueber den subIndex
// auf den KANONISCHEN Tenant auf - sowohl nach frischem Boot (hydrateSubIndex aus
// account) als auch OHNE Neustart (mintSession-Nach-Boot-Bind). Rein pglite, NIE mit
// Server-Spawn in derselben Datei (P6a-Stall-Lehre, Muster store-pg-idp-seed.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore } from "../src/store/pg.js";
import { makeAccounts } from "../src/web-auth.js";
import { tenantIdForSubject } from "../src/store/defaults.js";

// pglite ist ein-verbindig: withClient reicht die Instanz als Client durch (Muster
// store-pg-idp-seed.test.js).
const runnerFor = (db) => ({
  withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
});

const SHARED_EMAIL = "shared@x";
const SUB_1 = "u1";
const SUB_2 = "u2";
const TENANT_1 = tenantIdForSubject(SUB_1);

test("tenant-prolif-b: init() hydriert subIndex aus account -> gemergter sub2 loest kanonisch auf", async () => {
  const db = new PGlite();
  const boot = makePgStore(runnerFor(db));
  await boot.init(); // Schema anlegen
  const accounts = makeAccounts(runnerFor(db));
  await accounts.upsertOnFirstLogin({ sub: SUB_1, email: SHARED_EMAIL }); // t_u1 + account(u1)
  await accounts.upsertOnFirstLogin({ sub: SUB_2, email: SHARED_EMAIL }); // Phase-A-Merge: account(u2)->t_u1
  const reborn = makePgStore(runnerFor(db));
  await reborn.init(); // frischer Boot -> hydrateSubIndex
  assert.equal(reborn.resolveTenant(SUB_1), TENANT_1);
  assert.equal(reborn.resolveTenant(SUB_2), TENANT_1, "gemergter Zweit-sub loest auf den kanonischen Tenant");
  assert.equal(
    reborn.resolveTenant(SUB_1),
    reborn.resolveTenant(SUB_2),
    "beide subs -> derselbe Tenant",
  );
});

test("tenant-prolif-b: Nach-Boot-Login bindet gemergten sub ohne Neustart (kein Race)", async () => {
  const db = new PGlite();
  const store = makePgStore(runnerFor(db));
  await store.init();
  const accounts = makeAccounts(runnerFor(db));
  await accounts.upsertOnFirstLogin({ sub: SUB_1, email: SHARED_EMAIL }); // NACH init(): DB hat t_u1
  await accounts.upsertOnFirstLogin({ sub: SUB_2, email: SHARED_EMAIL }); // NACH init(): account(u2)->t_u1
  assert.equal(store.resolveTenant(SUB_2), null, "vor dem Bind kennt der Spiegel u2 nicht");
  await store.ensureTenant(TENANT_1); // mintSession-Schritt 1: Tenant in den Spiegel
  store.bindSubToTenant(SUB_2, TENANT_1); // mintSession-Schritt 2: sub in den Index
  assert.equal(store.resolveTenant(SUB_2), TENANT_1, "gemergter sub sofort aufloesbar (ohne reinit)");
  assert.equal(
    store.resolveTenant(SUB_1),
    TENANT_1,
    "Primaer-sub via idpSubject-Fallback (ensureTenant zog t_u1)",
  );
});

test("tenant-prolif-b: Onboard-Guard-Bedingung - resolveTenant(gemergt) != tenantIdForSubject", async () => {
  const db = new PGlite();
  const boot = makePgStore(runnerFor(db));
  await boot.init();
  const accounts = makeAccounts(runnerFor(db));
  await accounts.upsertOnFirstLogin({ sub: SUB_1, email: SHARED_EMAIL });
  await accounts.upsertOnFirstLogin({ sub: SUB_2, email: SHARED_EMAIL });
  const reborn = makePgStore(runnerFor(db));
  await reborn.init();
  const canonical = reborn.resolveTenant(SUB_2);
  assert.equal(canonical, TENANT_1);
  assert.notEqual(
    canonical,
    tenantIdForSubject(SUB_2),
    "u2 wuerde sonst t_u2 als Zweit-Tenant erzeugen",
  );
});
