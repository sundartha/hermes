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
