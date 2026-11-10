import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { neuePglite } from "../pglite-helfer.js";

const BRUECKE_ZEIT = "2026-11-10T10:00:00.000Z";
const EL_BEIN = "v3:el-bein-1";
const MAIL_ZEIT = "2026-11-10T11:00:00.000Z";

let makePgStore, BOOTSTRAP, publicCall;

before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-bruecke-spalten-"));
  await import("../../src/config.js");
  ({ makePgStore } = await import("../../src/store/pg.js"));
  ({ BOOTSTRAP_TENANT_ID: BOOTSTRAP } = await import("../../src/store/defaults.js"));
  ({ publicCall } = await import("../../src/store/views.js"));
});

async function makePgTestStore() {
  const db = await neuePglite();
  const runner = {
    withClient: (fn) =>
      fn({ query: (statement, parameter) => db.query(statement, parameter), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, runner };
}

async function neuGeoeffnet(runner) {
  const store = makePgStore(runner);
  await store.init();
  return store;
}

const neuerAnruf = () => ({
  direction: "outbound",
  from: "+4930111222333",
  to: "+4915112345678",
  goal: "Bruecke-Spalten-Roundtrip",
  tenantId: BOOTSTRAP,
});

test("K1+K3: bridgedAt und elCallControlId ueberleben Reopen und spaetere Flushes, Nachbarspalten verrutschen nicht", async () => {
  const { store, runner } = await makePgTestStore();
  const call = store.createCall(neuerAnruf());
  const stehend = store.getCall(call.id);
  stehend.bridgedAt = BRUECKE_ZEIT;
  stehend.elCallControlId = EL_BEIN;
  stehend.callerIsOwner = true;
  stehend.notPlacedMailSentAt = MAIL_ZEIT;
  await store.save();

  const erster = await neuGeoeffnet(runner);
  const geladen = erster.getCall(call.id);
  assert.equal(geladen.bridgedAt, BRUECKE_ZEIT);
  assert.equal(geladen.elCallControlId, EL_BEIN);
  assert.equal(geladen.callerIsOwner, true);
  assert.equal(geladen.notPlacedMailSentAt, MAIL_ZEIT);

  erster.recordFailureReason(call.id, "unreachable:probe");
  await erster.save();
  const zweiter = await neuGeoeffnet(runner);
  assert.equal(zweiter.getCall(call.id).bridgedAt, BRUECKE_ZEIT);
  assert.equal(zweiter.getCall(call.id).elCallControlId, EL_BEIN);
});

test("K2: ohne Werte sind beide Felder null", async () => {
  const { store, runner } = await makePgTestStore();
  const call = store.createCall(neuerAnruf());
  await store.save();
  const geladen = (await neuGeoeffnet(runner)).getCall(call.id);
  assert.equal(geladen.bridgedAt, null);
  assert.equal(geladen.elCallControlId, null);
});

test("K5: die Kundensicht enthaelt keines der beiden Felder", () => {
  const sicht = publicCall({
    id: "c1",
    tenantId: BOOTSTRAP,
    direction: "outbound",
    bridgedAt: BRUECKE_ZEIT,
    elCallControlId: EL_BEIN,
  });
  assert.equal("bridgedAt" in sicht, false);
  assert.equal("elCallControlId" in sicht, false);
});
