// P2 (C2, S1-3): pg/json-Paritaet fuer objectiveAchieved (Boolean-Serialisierungs-Drift).
// src/store/pg.js serialisiert objectiveAchieved (Boolean|String|null) beim Flush als
// TEXT (serializeObjective), las aber bis zu diesem Fix OHNE Rueck-Coercion
// (rowToCall) - ein Boolean wurde nach jedem pg-Neustart zur STRING. json speichert
// nativ (kein Drift) -> der Bug war im lokalen json-Dev strukturell unsichtbar. Dieser
// table-driven Rundlauf laeuft gegen BEIDE Backends, damit ein kuenftiger Typ-Drift
// laut wird statt still zu bleiben (Meta-Lehre, PLAN-FRAGILITY-REMEDIATION.md #2).
//
// Erweitern bei jeder neuen pg-Spalte mit nicht-trivialer Typabbildung (analog
// config-money-manifest.test.js): OBJECTIVE_ACHIEVED_CASES um einen Eintrag ergaenzen.
//
// DATA_DIR + config werden VOR allen store-Imports gebunden (json.FILE haengt an
// config.dataDir): darum laeuft die Verdrahtung ueber dynamische Imports in before()
// (Muster: test/assistant-context-persist-pg.test.js).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let makePgStore, PGlite, jsonStore, BOOTSTRAP, dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-pg-json-parity-"));
  process.env.DATA_DIR = dataDir;
  await import("../src/config.js");
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ PGlite } = await import("@electric-sql/pglite"));
  jsonStore = await import("../src/store/json.js");
  ({ BOOTSTRAP_TENANT_ID: BOOTSTRAP } = await import("../src/store/defaults.js"));
});

// pglite-Store hinter dem Runner-Vertrag (wie pg-helpers.js, hier inline wegen der
// DATA_DIR-Bindungsreihenfolge). Liefert {store, runner} fuer den Reopen.
async function makePgTestStore() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, runner };
}

const newCall = (over = {}) => ({
  direction: "outbound",
  from: "+49",
  to: "+49",
  tenantId: BOOTSTRAP,
  ...over,
});

// Ein voller pg-Rundlauf fuer EINEN objectiveAchieved-Wert: create -> mutate-then-save
// -> echter Reopen (frischer makePgStore auf derselben pglite-Instanz) -> Rueckgabe des
// hydrierten Werts. EINE Stelle fuer den Rundlauf (G5), von zwei Tests genutzt.
async function pgObjectiveRoundtrip(value) {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  store.getCall(created.id).objectiveAchieved = value;
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  return reopened.getCall(created.id).objectiveAchieved;
}

// Ein voller json-Rundlauf fuer EINEN objectiveAchieved-Wert: create -> mutate-then-save
// -> echter Disk-Read (JSON.parse(fs.readFileSync)). EINE Stelle (G5), von zwei Tests
// genutzt. json ist ein Modul-Singleton (state lebt ueber die ganze Testdatei) - jeder
// Aufruf erzeugt einen frischen Call (eigene id), keine Kollision zwischen Tests.
function jsonObjectiveRoundtrip(value) {
  const created = jsonStore.createCall(newCall());
  jsonStore.getCall(created.id).objectiveAchieved = value;
  jsonStore.save();
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  return onDisk.calls.find((c) => c.id === created.id).objectiveAchieved;
}

// objectiveAchieved-Werte, die claude.js fachlich setzt (Boolean true/false, der String
// "unclear" bei Mehrdeutigkeit, null wenn noch offen). Der Literal-String "true"/"false"
// ist NIE ein Fachwert (nur eine Serialisierungsform) - siehe deserializeObjective-Kommentar
// in pg.js. typeof null === "object": assert.equal(got, value) mit value=null ist fuer den
// null-Fall trivial wahr; die typeof-Assertion ist dort redundant, aber harmlos.
const OBJECTIVE_ACHIEVED_CASES = [
  ["true", true],
  ["false", false],
  ["'unclear'", "unclear"],
  ["null", null],
];

for (const [label, value] of OBJECTIVE_ACHIEVED_CASES) {
  test(`objectiveAchieved=${label}: pg-Roundtrip erhaelt Typ+Wert`, async () => {
    const got = await pgObjectiveRoundtrip(value);
    assert.equal(typeof got, typeof value);
    assert.equal(got, value);
  });

  test(`objectiveAchieved=${label}: json-Roundtrip erhaelt Typ+Wert (Disk)`, () => {
    const got = jsonObjectiveRoundtrip(value);
    assert.equal(typeof got, typeof value);
    assert.equal(got, value);
  });

  test(`objectiveAchieved=${label}: pg-Ergebnis == json-Ergebnis (Paritaet)`, async () => {
    // Waere vor dem S1-3-Fix im pg-Zweig rot gewesen: pg lieferte "true"/"false"-Strings,
    // json lieferte Booleans -> deepStrictEqual haette den Typ-Drift aufgedeckt.
    const pgResult = await pgObjectiveRoundtrip(value);
    const jsonResult = jsonObjectiveRoundtrip(value);
    assert.deepStrictEqual(pgResult, jsonResult);
  });
}
