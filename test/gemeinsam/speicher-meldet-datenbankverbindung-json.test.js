import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATENORDNER = fs.mkdtempSync(path.join(os.tmpdir(), "statusroute-json-"));
const { config } = await import("../../src/config.js");
Object.assign(config.server, { dataDir: DATENORDNER, webDistDir: path.join(DATENORDNER, "web") });
const speicher = await import("../../src/store.js");

after(() => fs.rmSync(DATENORDNER, { recursive: true, force: true }));

test("B2-S3: json-Speicher: Verbindungsprobe gelingt ohne Datenbank", async () => {
  assert.equal(config.store.storeBackend === "pg", false);
  assert.equal(await speicher.pruefeVerbindung(), undefined);
});
