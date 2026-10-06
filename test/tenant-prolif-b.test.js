import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore } from "../src/store/pg.js";
import { makeAccounts } from "../src/web-auth.js";
import { tenantIdForSubject } from "../src/store/defaults.js";
import { checkSubAlreadyMerged, SUB_ALREADY_MERGED_ERROR } from "../src/onboard-guard.js";

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
  await boot.init();
  const accounts = makeAccounts(runnerFor(db));
  await accounts.upsertOnFirstLogin({ sub: SUB_1, email: SHARED_EMAIL });
  await accounts.upsertOnFirstLogin({ sub: SUB_2, email: SHARED_EMAIL });
  const reborn = makePgStore(runnerFor(db));
  await reborn.init();
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
  await accounts.upsertOnFirstLogin({ sub: SUB_1, email: SHARED_EMAIL });
  await accounts.upsertOnFirstLogin({ sub: SUB_2, email: SHARED_EMAIL });
  assert.equal(store.resolveTenant(SUB_2), null, "vor dem Bind kennt der Spiegel u2 nicht");
  await store.ensureTenant(TENANT_1);
  store.bindSubToTenant(SUB_2, TENANT_1);
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

test("checkSubAlreadyMerged: gemergter Zweit-sub -> 409 + Fehlertext (blockt den Zweit-Tenant-Kauf)", async () => {
  const db = new PGlite();
  const boot = makePgStore(runnerFor(db));
  await boot.init();
  const accounts = makeAccounts(runnerFor(db));
  await accounts.upsertOnFirstLogin({ sub: SUB_1, email: SHARED_EMAIL });
  await accounts.upsertOnFirstLogin({ sub: SUB_2, email: SHARED_EMAIL });
  const reborn = makePgStore(runnerFor(db));
  await reborn.init();
  const result = checkSubAlreadyMerged({
    sub: SUB_2,
    tenantId: tenantIdForSubject(SUB_2),
    resolveTenant: reborn.resolveTenant,
  });
  assert.deepEqual(result, { status: 409, error: SUB_ALREADY_MERGED_ERROR });
});

test("checkSubAlreadyMerged: Primaer-sub (canonical === tenantId) -> null (kein falscher 409)", async () => {
  const db = new PGlite();
  const boot = makePgStore(runnerFor(db));
  await boot.init();
  const accounts = makeAccounts(runnerFor(db));
  await accounts.upsertOnFirstLogin({ sub: SUB_1, email: SHARED_EMAIL });
  const reborn = makePgStore(runnerFor(db));
  await reborn.init();
  const result = checkSubAlreadyMerged({
    sub: SUB_1,
    tenantId: tenantIdForSubject(SUB_1),
    resolveTenant: reborn.resolveTenant,
  });
  assert.equal(result, null);
});

test("checkSubAlreadyMerged: isoliert ohne Store - unbekannter sub -> null, sub-los (Operator-Pfad) -> null", () => {
  const noMatch = checkSubAlreadyMerged({
    sub: "unbekannt",
    tenantId: "t_unbekannt",
    resolveTenant: () => null,
  });
  assert.equal(noMatch, null, "resolveTenant liefert null -> kein Treffer, kein 409");

  const noSub = checkSubAlreadyMerged({
    sub: null,
    tenantId: "t_operator",
    resolveTenant: () => {
      throw new Error("resolveTenant darf ohne sub nie aufgerufen werden");
    },
  });
  assert.equal(noSub, null, "Operator-Pfad ohne idpSubject bleibt byte-identisch (kein Guard)");
});
