import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { neuePglite } from "./pglite-helfer.js";

let makePgStore, BOOTSTRAP;

before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-el-bein-pg-"));
  await import("../src/config.js");
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ BOOTSTRAP_TENANT_ID: BOOTSTRAP } = await import("../src/store/defaults.js"));
});

async function makePgTestStore() {
  const db = await neuePglite();
  const runner = {
    withClient: (fn) => fn({ query: (statement, parameter) => db.query(statement, parameter), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, runner };
}

const oeffne = async (runner) => {
  const store = makePgStore(runner);
  await store.init();
  return store;
};

const neuerAnruf = () => ({
  direction: "outbound",
  from: "+4930111222333",
  to: "+4915112345678",
  goal: "EL-Bein-Kennung",
  tenantId: BOOTSTRAP,
});

test("3553-K3: ein Anruf ohne EL-Bein laedt nach dem Neustart mit elCallControlId null", async () => {
  const { store, runner } = await makePgTestStore();
  const call = store.createCall(neuerAnruf());
  await store.save();
  const geladen = (await oeffne(runner)).getCall(call.id);
  assert.equal(geladen.elCallControlId, null);
});

test("3553-K4: ein aelterer Stand ohne Kennung ueberschreibt die gespeicherte Kennung nicht", async () => {
  const { store, runner } = await makePgTestStore();
  const call = store.createCall(neuerAnruf());
  await store.save();
  const aeltererStand = await oeffne(runner);
  store.getCall(call.id).elCallControlId = "cc_el_gespeichert";
  await store.save();
  aeltererStand.recordFailureReason(call.id, "unreachable:probe");
  await aeltererStand.save();
  const geladen = (await oeffne(runner)).getCall(call.id);
  assert.equal(geladen.elCallControlId, "cc_el_gespeichert");
});
