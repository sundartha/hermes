// CC-6: strukturelle Methodenmengen-Gleichheit json.js (Modul-Exports) vs.
// makePgStore(runner) (Objekt-Keys). Faengt die historische Drift-Klasse (eine neue
// json-Store-Methode ohne pg-Wrapper vergessen, "objectiveAchieved"-Bugklasse) ohne
// echte DB - reiner Struktur-Vergleich, kein Verhalten.
//
// DATA_DIR + config werden VOR allen store-Imports gebunden (json.FILE haengt an
// config.dataDir): darum laufen die Imports dynamisch in before() (Muster
// store-pg-json-parity.test.js). Der Stub-Runner wird bei der Konstruktion NICHT
// getouched (makePgStore ruft ihn erst bei init()/den einzelnen Methoden auf).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let json, makePgStore;

before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-store-parity-"));
  process.env.DATA_DIR = dataDir;
  await import("../src/config.js");
  json = await import("../src/store/json.js");
  ({ makePgStore } = await import("../src/store/pg.js"));
});

// pg-only Methoden, die strukturell KEIN json-Pendant haben (begruendete Ausnahme,
// kein Drift): init() ist die async Schema-/Hydrierungs-Migration des pg-Backends -
// json braucht keine, es liest die Datei synchron beim ersten load().
const PG_ONLY_ALLOWLIST = new Set(["init"]);

const stubRunner = {
  withClient: async (fn) => fn({ query: async () => ({ rows: [] }), exec: async () => {} }),
};

test("CC-6: jede json-Store-Methode hat ein pg-Pendant (kein vergessener pg-Wrapper)", () => {
  const pg = makePgStore(stubRunner);
  const jsonKeys = new Set(Object.keys(json).filter((k) => typeof json[k] === "function"));
  const pgKeys = new Set(Object.keys(pg).filter((k) => typeof pg[k] === "function"));
  const missingInPg = [...jsonKeys].filter((k) => !pgKeys.has(k));
  assert.deepEqual(missingInPg, [], "json-Store-Methoden ohne pg-Pendant (Drift)");
});

test("CC-6: pg traegt KEINE json-fremde Methode ausser der Allowlist (init)", () => {
  const pg = makePgStore(stubRunner);
  const jsonKeys = new Set(Object.keys(json).filter((k) => typeof json[k] === "function"));
  const pgKeys = new Set(Object.keys(pg).filter((k) => typeof pg[k] === "function"));
  const extraInPg = [...pgKeys].filter((k) => !jsonKeys.has(k) && !PG_ONLY_ALLOWLIST.has(k));
  assert.deepEqual(extraInPg, [], "pg-Methoden ohne json-Pendant, ausserhalb der Allowlist");
});
