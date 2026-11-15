import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedCall, seedState } from "../helpers.js";

let jsonStore;

before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-lebenslauf-json-"));
  await import("../../src/config.js");
  jsonStore = await import("../../src/store/json.js");
  fs.writeFileSync(
    path.join(process.env.DATA_DIR, "store.json"),
    JSON.stringify(seedState({ calls: [seedCall({ id: "call_lebenslauf_json" })] })),
  );
});

test("LEBENSLAUF-12: endCallRecord ohne Status beendet den Anruf im JSON-Speicher mit completed", async () => {
  const ergebnis = await jsonStore.endCallRecord("call_lebenslauf_json");
  assert.equal(ergebnis.status, "completed");
  assert.equal(jsonStore.getCall("call_lebenslauf_json").status, "completed");
});
