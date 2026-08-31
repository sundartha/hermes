// OUTBOUND-E5 (F3): Neustart-Round-Trip der Absender-Wahrheit gegen ECHTES Postgres-SQL
// (PGlite, embedded WASM - kein Netz, keine externe DB noetig, Muster
// test/store-pg-json-parity.test.js). STAERKER als ein DATABASE_URL-Skip-Gate: dieser Lauf
// PRUEFT den Rundlauf immer, statt ihn bei fehlender externer DB zu uebergehen - "Prod-DB-
// Write braucht Neustart" (pg-store-holds-state-in-memory): der Spiegel wird hier
// WIRKLICH verworfen (frischer makePgStore auf demselben Runner) und neu hydriert.
//
// DATA_DIR + config VOR allen store-Imports gebunden (Muster el-sip-call-id-join.test.js).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let makePgStore, PGlite, BOOTSTRAP, requestNumber, beginProvisioning, activateNumber, attachNumberRegistration, registerTenant, FROM_SOURCE;

before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-absender-wahrheit-pg-"));
  process.env.DATA_DIR = dataDir;
  await import("../src/config.js");
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ PGlite } = await import("@electric-sql/pglite"));
  ({ BOOTSTRAP_TENANT_ID: BOOTSTRAP } = await import("../src/store/defaults.js"));
  ({ requestNumber, beginProvisioning, activateNumber, attachNumberRegistration, registerTenant, FROM_SOURCE } =
    await import("../src/store/state-ops.js"));
});

async function makePgTestStore() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, runner };
}

async function reopen(runner) {
  const reopened = makePgStore(runner);
  await reopened.init();
  return reopened;
}

// Test 1: alle DREI Call-Spalten ueberleben einen echten Reopen.
test("Call-Spalten (fromActualE164/fromSource/fromRegistrationSource) ueberleben einen echten Reopen", async () => {
  const { store, runner } = await makePgTestStore();
  const call = store.createCall({
    direction: "outbound",
    from: "+18643028341",
    to: "+4915005550002",
    tenantId: BOOTSTRAP,
  });
  store.recordActualSender(call.id, { e164: "+18643028341", source: FROM_SOURCE.TENANT_DID });
  store.recordFromRegistrationSource(call.id, "tenant_did");
  await store.save();

  const reopened = await reopen(runner);
  const gespeichert = reopened.getCall(call.id);
  assert.equal(gespeichert.fromActualE164, "+18643028341");
  assert.equal(gespeichert.fromSource, FROM_SOURCE.TENANT_DID);
  assert.equal(gespeichert.fromRegistrationSource, "tenant_did");
});

// Test 2: number.providerAgentPhoneNumberId ueberlebt einen echten Reopen.
test("number.providerAgentPhoneNumberId ueberlebt einen echten Reopen", async () => {
  const { store, runner } = await makePgTestStore();
  const state = store.load();
  registerTenant(state, "t_pg_test1");
  const { number } = requestNumber(state, {
    tenantId: "t_pg_test1",
    maxNumbers: 10,
    maxNumbersPerTenant: 5,
  });
  beginProvisioning(state, number.id);
  activateNumber(state, number.id, { e164: "+18643028341", providerNumberId: "ext_1" });
  attachNumberRegistration(state, number.id, "phnum_pg_test1");
  await store.save();

  const reopened = await reopen(runner);
  const gespeicherteNummer = reopened.load().numbers.find((eintrag) => eintrag.id === number.id);
  assert.equal(gespeicherteNummer.providerAgentPhoneNumberId, "phnum_pg_test1");
});

// Test 3: Bestandszeile OHNE Backfill hydriert als null - fuer JEDE der drei Call-Spalten
// UND die Nummern-Spalte (der dokumentierte "kein Backfill"-Fall, Plan §4.1).
test("Bestandszeile ohne gesetzte Werte hydriert als null (kein Backfill, kein undefined-Drift)", async () => {
  const { store, runner } = await makePgTestStore();
  const call = store.createCall({
    direction: "outbound",
    from: "+18643028341",
    to: "+4915005550002",
    tenantId: BOOTSTRAP,
  });
  const state = store.load();
  registerTenant(state, "t_pg_test2");
  const { number } = requestNumber(state, {
    tenantId: "t_pg_test2",
    maxNumbers: 10,
    maxNumbersPerTenant: 5,
  });
  beginProvisioning(state, number.id);
  activateNumber(state, number.id, { e164: "+15005559999", providerNumberId: "ext_2" });
  // KEIN attachNumberRegistration - die Nummer bleibt unregistriert (Bestandsfall).
  await store.save();

  const reopened = await reopen(runner);
  const gespeicherterCall = reopened.getCall(call.id);
  assert.equal(gespeicherterCall.fromActualE164, null);
  assert.equal(gespeicherterCall.fromSource, null);
  assert.equal(gespeicherterCall.fromRegistrationSource, null);
  const gespeicherteNummer = reopened.load().numbers.find((eintrag) => eintrag.id === number.id);
  assert.equal(gespeicherteNummer.providerAgentPhoneNumberId, null, "NULL, kein undefined-Drift nach der Hydrierung");
});
