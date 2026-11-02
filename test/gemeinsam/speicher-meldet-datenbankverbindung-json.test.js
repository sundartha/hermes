import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROBE_FEHLT = "Probe fehlt an der Fassade";
const DATENORDNER = fs.mkdtempSync(path.join(os.tmpdir(), "statusroute-json-"));
const { config } = await import("../../src/config.js");
Object.assign(config.server, { dataDir: DATENORDNER, webDistDir: path.join(DATENORDNER, "web") });
const speicher = await import("../../src/store.js");

after(() => fs.rmSync(DATENORDNER, { recursive: true, force: true }));

test("json-Speicher: Verbindungsprobe gelingt ohne Datenbank", async () => {
  assert.equal(config.store.storeBackend === "pg", false);
  assert.equal(await speicher.pruefeVerbindung(), undefined);
});

test("[NIE2] json-Speicher: die Probe erfüllt sofort ohne Wert und braucht keine Datenbank", async () => {
  assert.equal(typeof speicher.pruefeVerbindung, "function", PROBE_FEHLT);
  const noch = Symbol("noch offen");
  const ergebnis = await Promise.race([speicher.pruefeVerbindung(), Promise.resolve(noch)]);
  assert.equal(ergebnis, undefined);
});

test("[NIE3] json-Speicher: poolZustand meldet weiter null", () => {
  assert.equal(speicher.poolZustand(), null);
});
