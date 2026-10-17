import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DURCHGELASSEN,
  FEHLALARME_DIR,
  GESTOPPT,
  cases,
  manifests,
  runCase,
} from "../../tools/pruefungen-messen.mjs";
import { REPO_ROOT } from "./probe-repo.js";

const CONTEXT = { root: REPO_ROOT };
const ALTE_DATEI_DA = {
  befehl: ["node", "-e", "process.exitCode = require('node:fs').existsSync('src/alt.js') ? 0 : 1"],
};

test("eine Rot-Probe löscht die unter loeschen genannte Datei im Nachher-Stand", async () => {
  const fall = {
    titel: "Umbenennung",
    vorher: { "src/alt.js": ["export const wert = 1;"] },
    loeschen: ["src/alt.js"],
    dateien: { "src/alt.ts": ["export const wert: number = 1;"] },
  };
  assert.equal(await runCase(CONTEXT, ALTE_DATEI_DA, fall), GESTOPPT);
  assert.equal(await runCase(CONTEXT, ALTE_DATEI_DA, { ...fall, loeschen: [] }), DURCHGELASSEN);
});

test("eine Rot-Probe, die eine nicht vorhandene Datei löscht, bricht ab statt weiterzulaufen", async () => {
  const fall = {
    titel: "Tippfehler im Pfad",
    vorher: { "src/alt.js": ["export const wert = 1;"] },
    loeschen: ["src/alte.js"],
    dateien: { "src/alt.ts": ["export const wert: number = 1;"] },
  };
  await assert.rejects(runCase(CONTEXT, ALTE_DATEI_DA, fall), /src\/alte\.js/);
});

test("die Umbenennungs-Prüfung lässt ihre Fehlalarm-Beispiele durch", async () => {
  const { probe } = manifests(REPO_ROOT).get("umbenennung");
  const beispiele = [...cases(REPO_ROOT, `${FEHLALARME_DIR}/umbenennung`)];
  assert.ok(beispiele.length > 0);
  for (const [path, fall] of beispiele) {
    assert.equal(await runCase(CONTEXT, probe, fall), DURCHGELASSEN, path);
  }
});
