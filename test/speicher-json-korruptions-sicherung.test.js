import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATEN = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-korrupt-"));
const KAPUTT = "{ this is not json";
process.env.DATA_DIR = DATEN;
fs.writeFileSync(path.join(DATEN, "store.json"), KAPUTT);

const store = await import("../src/store.js");

test("Korruptions-Sicherung: Dateiname traegt Zeitstempel mit Bindestrichen, Original bleibt erhalten", () => {
  const ausgaben = [];
  const original = console.error;
  console.error = (...args) => ausgaben.push(args.join(" "));
  try {
    store.load();
  } finally {
    console.error = original;
  }
  const sicherung = fs.readdirSync(DATEN).filter((f) => f.startsWith("store.json.corrupt-"));
  assert.equal(sicherung.length, 1);
  assert.match(sicherung[0], /^store\.json\.corrupt-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/);
  assert.equal(fs.readFileSync(path.join(DATEN, sicherung[0]), "utf8"), KAPUTT);
  assert.ok(
    ausgaben.some((a) => a.includes(`umbenannt nach ${path.join(DATEN, sicherung[0])}. Store startet`)),
  );
});
