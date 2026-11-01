import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, isolatedEnvironment } from "./probe-repo.js";

const REPORTER = join(REPO_ROOT, "tools/testlaufzeit-reporter.mjs");
const LAUF_FRIST_MS = 60_000;
const IMPORT_TEST = 'import { test } from "node:test";';

const DATEIEN = {
  "gruen.test.js": [
    IMPORT_TEST,
    'test("oben", async (t) => { await t.test("unten", () => {}); });',
  ],
  "uebersprungen.test.js": [IMPORT_TEST, 'test("später", { skip: true }, () => {});'],
  "rot.test.js": [
    IMPORT_TEST,
    'test("gut", () => {});',
    'test("schlecht", () => { throw new Error("rot"); });',
  ],
  "unten-rot.test.js": [
    IMPORT_TEST,
    'test("oben", async (t) => { await t.test("unten", () => { throw new Error("rot"); }); });',
  ],
  "absturz.test.js": ['throw new Error("beim Laden");'],
};

function berichteteDateien(context) {
  const ordner = mkdtempSync(join(tmpdir(), "uebernahme-bestanden-"));
  context.after(() => rmSync(ordner, { recursive: true, force: true }));
  for (const [name, zeilen] of Object.entries(DATEIEN)) {
    writeFileSync(join(ordner, name), `${zeilen.join("\n")}\n`);
  }
  const ziel = join(ordner, "dateien.jsonl");
  spawnSync(
    process.execPath,
    [
      "--test",
      `--test-reporter=${REPORTER}`,
      `--test-reporter-destination=${ziel}`,
      ...Object.keys(DATEIEN),
    ],
    { cwd: ordner, env: isolatedEnvironment(), timeout: LAUF_FRIST_MS },
  );
  const zeilen = readFileSync(ziel, "utf8").trim().split("\n");
  return new Map(zeilen.map((zeile) => [JSON.parse(zeile).datei, JSON.parse(zeile)]));
}

test("der Reporter hält je Testdatei fest, ob sie bestanden hat", (context) => {
  const berichtet = berichteteDateien(context);
  const bestanden = Object.fromEntries(
    Object.keys(DATEIEN).map((name) => [name, berichtet.get(name)?.bestanden]),
  );
  assert.deepEqual(bestanden, {
    "gruen.test.js": true,
    "uebersprungen.test.js": true,
    "rot.test.js": false,
    "unten-rot.test.js": false,
    "absturz.test.js": false,
  });
});
