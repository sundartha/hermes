// OC-P1 (PLAN-OWNER-CALL, Spec Abschnitt 6 C): Store-Roundtrip fuer calleeIsOwner, beide
// Backends. Muster json<->pg wie test/persona-style.test.js + test/persona-style-pg.test.js.
// Gepinnt wird: geschrieben true -> gelesen true; gar nicht gesetzt -> gelesen false (nie
// undefined, nie null); ein Call-Datensatz OHNE das Feld (Bestandsform, vor OC-P1
// angelegt) liest false (json: CALL_FIELD_DEFAULTS, F2; pg: NOT NULL DEFAULT FALSE).
//
// DATA_DIR + config werden VOR allen store-Imports gebunden (json.js#FILE haengt an
// config.dataDir): darum laeuft die Verdrahtung ueber dynamische Imports in before()
// (Muster: test/store-pg-json-parity.test.js) - ein statischer Import von store/pg.js
// (bindet config.js sofort) waere hier ein Ladereihenfolge-Fehler.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { seedState, seedCall } from "./helpers.js";

const TENANT = BOOTSTRAP_TENANT_ID;
// G25: kein Magic-Value - der Einrueckungswert von JSON.stringify (Muster src/store/
// json.js#JSON_INDENT), menschenlesbar fuer die manuell geschriebene Bestandszeile.
const JSON_INDENT = 2;

let createCall, jsonStore, makePgStore, PGlite, jsonDataDir;

before(async () => {
  // Eigenes, LEERES DATA_DIR fuer den json-Backend-Teil (OC-P1-53): json.js#load() cached
  // sein `state` modulweit - store.json muss VOR dem ersten load()-Aufruf im Zielverzeichnis
  // liegen, das exponierte jsonDataDir ist genau dieser eine Pfad.
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

// pglite-Store hinter dem Runner-Vertrag (Muster test/pg-helpers.js, hier inline wegen
// der DATA_DIR-Bindungsreihenfolge). Liefert {store, db, runner} fuer den Reopen.
async function makePgTestStore() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, db, runner };
}

// ---- json (state-ops, in-memory) ----

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

// ---- json (Platte): Bestandszeile ohne das Feld ----

test("OC-P1-53: json-Bestandszeile OHNE calleeIsOwner-Feld hydriert ueber load() auf false", () => {
  const bestandsCall = seedCall({ id: "call_bestand_oc_p1" });
  // seedCall traegt bewusst KEIN calleeIsOwner-Feld - so sah jeder Call vor OC-P1 aus.
  assert.ok(!("calleeIsOwner" in bestandsCall), "Vorbedingung: Bestandsform ohne das Feld");

  // In GENAU das DATA_DIR schreiben, an das json.js#FILE seit before() gebunden ist -
  // load() cached sein `state` modulweit, das store.json muss also VOR dem ersten
  // load()-Aufruf in diesem Prozess an Ort und Stelle liegen (kein zweiter Prozess noetig,
  // da dies der erste load()-Aufruf des gesamten Testfiles ist).
  fs.writeFileSync(
    path.join(jsonDataDir, "store.json"),
    JSON.stringify(seedState({ calls: [bestandsCall] }), null, JSON_INDENT),
  );

  const loaded = jsonStore.load();
  const call = loaded.calls.find((entry) => entry.id === "call_bestand_oc_p1");
  assert.strictEqual(call.calleeIsOwner, false, "Bestandszeile hydriert auf false, nie undefined");
  assert.equal(typeof call.calleeIsOwner, "boolean");
});

// ---- pg ----

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
  // Direkt auf den Spalten-DEFAULT zuruecksetzen - simuliert eine vor OC-P1 angelegte
  // Zeile, deren Migration ausschliesslich ueber DEFAULT FALSE lief (kein Backfill, E6).
  await db.query("UPDATE call SET callee_is_owner = DEFAULT WHERE id = $1", [created.id]);
  const reopened = makePgStore(runner);
  await reopened.init();
  const call = reopened.getCall(created.id);
  assert.strictEqual(call.calleeIsOwner, false);
});

test("OC-P1-57: pg set-once - eine spaetere In-Memory-Aenderung ueberlebt KEINEN zweiten Flush", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCallInput({ calleeIsOwner: false }));
  await store.save();

  // Jemand dreht den In-Memory-Wert NACH dem ersten Flush auf true und speichert erneut.
  // Die Spalte steht bewusst NICHT im ON CONFLICT DO UPDATE SET (Muster diagnostic,
  // set-once) - der zweite Flush darf den Wert NICHT uebernehmen.
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
