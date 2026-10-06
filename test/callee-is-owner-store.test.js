import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { seedState, seedCall } from "./helpers.js";

const TENANT = BOOTSTRAP_TENANT_ID;
const JSON_INDENT = 2;

let createCall, jsonStore, makePgStore, PGlite, jsonDataDir;

before(async () => {
  jsonDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-oc-p1-store-"));
  process.env.DATA_DIR = jsonDataDir;
  await import("../src/config.js");
  ({ createCall } = await import("../src/store/state-ops.js"));
  jsonStore = await import("../src/store/json.js");
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ PGlite } = await import("@electric-sql/pglite"));
});

const newCallInput = (over = {}) => ({
  direction: "outbound",
  from: "+4930111222333",
  to: "+491737252163",
  tenantId: TENANT,
  ...over,
});

async function makePgTestStore() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, db, runner };
}

test("OC-P1-50: json createCall({calleeIsOwner:true}) -> call.calleeIsOwner === true", () => {
  const state = seedState({});
  const call = createCall(state, newCallInput({ calleeIsOwner: true }));
  assert.strictEqual(call.calleeIsOwner, true);
});

test("OC-P1-51: json createCall(...) OHNE den Parameter -> false, nie undefined/null", () => {
  const state = seedState({});
  const call = createCall(state, newCallInput());
  assert.strictEqual(call.calleeIsOwner, false);
  assert.equal(typeof call.calleeIsOwner, "boolean");
});

test('OC-P1-52: Rohwerte ("true", 1, {}) als Parameter -> false, nie der Rohwert', () => {
  const state = seedState({});
  assert.strictEqual(createCall(state, newCallInput({ calleeIsOwner: "true" })).calleeIsOwner, false);
  assert.strictEqual(createCall(state, newCallInput({ calleeIsOwner: 1 })).calleeIsOwner, false);
  assert.strictEqual(createCall(state, newCallInput({ calleeIsOwner: {} })).calleeIsOwner, false);
});

test("OC-P1-53: json-Bestandszeile OHNE calleeIsOwner-Feld hydriert ueber load() auf false", () => {
  const bestandsCall = seedCall({ id: "call_bestand_oc_p1" });
  assert.ok(!("calleeIsOwner" in bestandsCall), "Vorbedingung: Bestandsform ohne das Feld");

  fs.writeFileSync(
    path.join(jsonDataDir, "store.json"),
    JSON.stringify(seedState({ calls: [bestandsCall] }), null, JSON_INDENT),
  );

  const loaded = jsonStore.load();
  const call = loaded.calls.find((entry) => entry.id === "call_bestand_oc_p1");
  assert.strictEqual(call.calleeIsOwner, false, "Bestandszeile hydriert auf false, nie undefined");
  assert.equal(typeof call.calleeIsOwner, "boolean");
  assert.ok(!("callerIsOwner" in bestandsCall), "Vorbedingung: Bestandsform ohne das Feld");
  assert.strictEqual(call.callerIsOwner, false, "Bestandszeile hydriert auf false, nie undefined");
  assert.equal(typeof call.callerIsOwner, "boolean");
});

test("OC-P1-54: pg createCall(true) -> save -> Reopen -> calleeIsOwner === true", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCallInput({ calleeIsOwner: true }));
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  const call = reopened.getCall(created.id);
  assert.strictEqual(call.calleeIsOwner, true, "Spalte + Flush + Hydrat gemappt");
});

test("OC-P1-55: pg createCall(false) -> save -> Reopen -> calleeIsOwner === false", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCallInput({ calleeIsOwner: false }));
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  const call = reopened.getCall(created.id);
  assert.strictEqual(call.calleeIsOwner, false);
  assert.equal(typeof call.calleeIsOwner, "boolean");
});

test("OC-P1-56: pg-Bestandszeile ohne Wert (Spalten-Default) -> Reopen -> false", async () => {
  const { store, runner, db } = await makePgTestStore();
  const created = store.createCall(newCallInput());
  await store.save();
  await db.query("UPDATE call SET callee_is_owner = DEFAULT WHERE id = $1", [created.id]);
  const reopened = makePgStore(runner);
  await reopened.init();
  const call = reopened.getCall(created.id);
  assert.strictEqual(call.calleeIsOwner, false);
});

const newInboundCallInput = (over = {}) =>
  newCallInput({ direction: "inbound", from: "+491737252163", to: "+4930111222333", ...over });

test("IEP-P6-40: json createCall({callerIsOwner:true}) -> true; ohne Parameter false (Boolean, nie undefined)", () => {
  const state = seedState({});
  assert.strictEqual(createCall(state, newInboundCallInput({ callerIsOwner: true })).callerIsOwner, true);
  const ohne = createCall(state, newInboundCallInput());
  assert.strictEqual(ohne.callerIsOwner, false);
  assert.equal(typeof ohne.callerIsOwner, "boolean");
});

test('IEP-P6-41: Rohwerte ("true", 1, {}) -> false, nie der Rohwert', () => {
  const state = seedState({});
  assert.strictEqual(createCall(state, newInboundCallInput({ callerIsOwner: "true" })).callerIsOwner, false);
  assert.strictEqual(createCall(state, newInboundCallInput({ callerIsOwner: 1 })).callerIsOwner, false);
  assert.strictEqual(createCall(state, newInboundCallInput({ callerIsOwner: {} })).callerIsOwner, false);
});

test("IEP-P6-42: die zwei Owner-Felder sind unabhaengig - keines setzt das andere", () => {
  const state = seedState({});
  const eingehend = createCall(state, newInboundCallInput({ callerIsOwner: true }));
  assert.strictEqual(eingehend.callerIsOwner, true);
  assert.strictEqual(eingehend.calleeIsOwner, false, "Inbound-Owner-Ton setzt den OUTBOUND-Waechter nicht");

  const ausgehend = createCall(state, newCallInput({ calleeIsOwner: true }));
  assert.strictEqual(ausgehend.calleeIsOwner, true);
  assert.strictEqual(ausgehend.callerIsOwner, false);
});

test("IEP-P6-43: pg createCall(true) -> save -> Reopen -> callerIsOwner === true", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newInboundCallInput({ callerIsOwner: true }));
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  assert.strictEqual(reopened.getCall(created.id).callerIsOwner, true, "Spalte + Flush + Hydrat gemappt");
});

test("IEP-P6-44: pg-Bestandszeile ohne Wert (Spalten-Default) -> Reopen -> false", async () => {
  const { store, runner, db } = await makePgTestStore();
  const created = store.createCall(newInboundCallInput());
  await store.save();
  await db.query("UPDATE call SET caller_is_owner = DEFAULT WHERE id = $1", [created.id]);
  const reopened = makePgStore(runner);
  await reopened.init();
  const call = reopened.getCall(created.id);
  assert.strictEqual(call.callerIsOwner, false);
  assert.equal(typeof call.callerIsOwner, "boolean");
});

test("IEP-P6-45: pg set-once - eine spaetere In-Memory-Aenderung ueberlebt KEINEN zweiten Flush", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newInboundCallInput({ callerIsOwner: false }));
  await store.save();

  store.getCall(created.id).callerIsOwner = true;
  await store.save();

  const reopened = makePgStore(runner);
  await reopened.init();
  assert.strictEqual(
    reopened.getCall(created.id).callerIsOwner,
    false,
    "set-once: der Create-Wert bleibt massgeblich, ein spaeterer Flush schreibt ihn nicht um",
  );
});

test("OC-P1-57: pg set-once - eine spaetere In-Memory-Aenderung ueberlebt KEINEN zweiten Flush", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCallInput({ calleeIsOwner: false }));
  await store.save();

  store.getCall(created.id).calleeIsOwner = true;
  await store.save();

  const reopened = makePgStore(runner);
  await reopened.init();
  const call = reopened.getCall(created.id);
  assert.strictEqual(
    call.calleeIsOwner,
    false,
    "set-once: der Create-Wert bleibt massgeblich, ein spaeterer Flush schreibt ihn nicht um",
  );
});
