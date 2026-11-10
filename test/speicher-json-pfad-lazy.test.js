import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ERSTES_VERZEICHNIS = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-pfad-a-"));
const SPAETERES_VERZEICHNIS = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-pfad-b-"));
process.env.DATA_DIR = ERSTES_VERZEICHNIS;

const { config } = await import("../src/config.js");
const jsonStore = await import("../src/store.js");

test("store.json entsteht im Ordner, der beim ersten load() gilt, nicht beim Import", () => {
  config.server.dataDir = SPAETERES_VERZEICHNIS;
  jsonStore.load();
  assert.equal(fs.existsSync(path.join(SPAETERES_VERZEICHNIS, "store.json")), true);
  assert.equal(fs.existsSync(path.join(ERSTES_VERZEICHNIS, "store.json")), false);
});

test("save() schreibt in den aktuellen Datenordner", () => {
  jsonStore.save();
  const dateien = fs.readdirSync(SPAETERES_VERZEICHNIS);
  assert.deepEqual(dateien, ["store.json"]);
  assert.deepEqual(fs.readdirSync(ERSTES_VERZEICHNIS), []);
});
