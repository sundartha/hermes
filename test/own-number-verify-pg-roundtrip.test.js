// OC-Besitz-Verifikation (pg): Round-Trip hydrate->flush->hydrate. Deckt Schema (die fuenf
// private_number_*-Spalten) + TENANT_COLUMNS + rowToTenant + flushTenants zusammen ab
// (I8-Landmine: fehlt eine Spalte an EINER der vier Stellen, loescht der naechste Flush den
// Wert oder er kommt nach einem Deploy-Neustart nie zurueck). pglite = kein Netz (F.I.R.S.T.).
// Muster newsletter-recipients-pg-roundtrip.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore } from "./pg-helpers.js";
import * as ops from "../src/store/state-ops.js";

const OWN = "+491737252163";

test("pg: Stufe-1-Token (privateNumberConfirmTokenHash/-ExpiresAt) ueberlebt hydrate->flush->hydrate", async () => {
  const { store, runner } = await makePgTestStore();
  const tenantId = "user_onv_pending";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "Max" });
  store.setPrivateNumber(tenantId, OWN);
  store.startPrivateNumberEmailConfirmation(tenantId, {
    tokenHash: "hash_pending",
    tokenExpiresAt: "2026-08-16T12:00:00.000Z",
  });

  const store2 = makePgStore(runner);
  await store2.init();
  const state = store2.privateNumberVerification(tenantId);
  assert.equal(state.emailConfirmed, false, "noch nicht bestaetigt");
  assert.equal(store2.tenantPrivateNumber(tenantId), OWN);
});

test("pg: confirmPrivateNumberByToken (emailConfirmedAt + geleerter Token) ueberlebt den Reload", async () => {
  const { store, runner } = await makePgTestStore();
  const tenantId = "user_onv_confirmed";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "Lea" });
  store.setPrivateNumber(tenantId, OWN);
  store.startPrivateNumberEmailConfirmation(tenantId, {
    tokenHash: "hash_confirmed",
    tokenExpiresAt: "2026-08-16T12:00:00.000Z",
  });
  const confirmResult = store.confirmPrivateNumberByToken("hash_confirmed", "2026-08-14T12:00:00.000Z");
  assert.ok(confirmResult, "Bestaetigung im Ausgangsstore erfolgreich");

  const store2 = makePgStore(runner);
  await store2.init();
  const state = store2.privateNumberVerification(tenantId);
  assert.equal(state.emailConfirmed, true, "Bestaetigung ueberlebt den Reload");
  assert.equal(state.verified, false, "Stufe 2 noch nicht durchlaufen");
});

test("pg: verifyPrivateNumberByInboundCall (privateNumberVerifiedAt) ueberlebt den Reload", async () => {
  const { store, runner } = await makePgTestStore();
  const tenantId = "user_onv_verified";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "Tim" });
  store.setPrivateNumber(tenantId, OWN);
  store.startPrivateNumberEmailConfirmation(tenantId, { tokenHash: "h", tokenExpiresAt: "2099-01-01T00:00:00.000Z" });
  store.confirmPrivateNumberByToken("h", "2026-08-14T00:00:00.000Z");
  const verifyResult = store.verifyPrivateNumberByInboundCall(tenantId, OWN, "2026-08-15T00:00:00.000Z");
  assert.equal(verifyResult.verified, true);

  const store2 = makePgStore(runner);
  await store2.init();
  assert.equal(store2.tenantPrivateNumberVerified(tenantId), true);
  assert.equal(store2.privateNumberVerification(tenantId).verifiedAt, "2026-08-15T00:00:00.000Z");
});

test("pg: Nummernwechsel resettet den Verifikationszustand ueber den Reload hinweg", async () => {
  const { store, runner } = await makePgTestStore();
  const tenantId = "user_onv_reset";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "Ina" });
  store.setPrivateNumber(tenantId, OWN);
  store.startPrivateNumberEmailConfirmation(tenantId, { tokenHash: "h", tokenExpiresAt: "2099-01-01T00:00:00.000Z" });
  store.confirmPrivateNumberByToken("h", "2026-08-14T00:00:00.000Z");
  store.setPrivateNumber(tenantId, "+491729999001"); // andere Nummer -> Reset

  const store2 = makePgStore(runner);
  await store2.init();
  const state = store2.privateNumberVerification(tenantId);
  assert.equal(state.emailConfirmed, false, "Reset ueberlebt den Reload");
  assert.equal(state.verified, false);
});

test("pg: Tageslimit-Log (privateNumberConfirmMailLog) ueberlebt den Reload", async () => {
  const { store, runner } = await makePgTestStore();
  const tenantId = "user_onv_daily";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "Nora" });
  store.startPrivateNumberEmailConfirmation(tenantId, {
    tokenHash: "h",
    tokenExpiresAt: "x",
    now: "2026-08-14T12:00:00.000Z",
  });

  const store2 = makePgStore(runner);
  await store2.init();
  const count = store2.dailyPrivateNumberConfirmMailCount(tenantId, "2026-08-14T00:00:00.000Z");
  assert.equal(count, 1, "Log-Eintrag ueberlebt den Reload und zaehlt im Fenster");
});

test("pg: Tenant ohne Besitz-Verifikationsdaten -> fail-closed Defaults nach Reload (kein Backfill)", async () => {
  const { store, runner } = await makePgTestStore();
  const tenantId = "user_onv_untouched";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "Alt" });
  await store.save();

  const store2 = makePgStore(runner);
  await store2.init();
  assert.deepEqual(store2.privateNumberVerification(tenantId), { emailConfirmed: false, verified: false, verifiedAt: null });
  assert.equal(store2.tenantPrivateNumberVerified(tenantId), false);
  assert.equal(store2.dailyPrivateNumberConfirmMailCount(tenantId, "2020-01-01T00:00:00.000Z"), 0);
});
