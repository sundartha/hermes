import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATEN = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-korrupt-fehl-"));
const KAPUTT = "{ this is not json";
process.env.DATA_DIR = DATEN;
fs.writeFileSync(path.join(DATEN, "store.json"), KAPUTT);

const store = await import("../../src/store.js");

test("fehlgeschlagene Sicherung: Log nennt Pfad des unveraenderten Originals, ohne Fehlertext", () => {
  const ausgaben = [];
  const original = console.error;
  const renameOriginal = fs.renameSync;
  console.error = (...args) => ausgaben.push(args.join(" "));
  fs.renameSync = () => {
    const fehler = new Error("GEHEIMER-FEHLERTEXT");
    fehler.code = "EACCES";
    throw fehler;
  };
  try {
    assert.throws(() => store.load(), /fail-closed/);
  } finally {
    console.error = original;
    fs.renameSync = renameOriginal;
  }
  const datei = path.join(DATEN, "store.json");
  assert.equal(
    ausgaben[0],
    `[store] KORRUPTES store.json erkannt - Sicherung FEHLGESCHLAGEN (EACCES). ` +
      `Original bleibt unveraendert unter ${datei}. Fail-closed: kein Start mit Defaults.`,
  );
  assert.equal(fs.readFileSync(datei, "utf8"), KAPUTT);
});
