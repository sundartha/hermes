// tenant-prolif-b: json-Backend-Ephemeralitaet + Migration des subIndex-Resolver-Index.
// Seedet einen LEGACY-Store OHNE subIndex-Key (wie ein store.json vor dieser Phase), damit
// der load()-Migrationspfad (state.subIndex ||= {}) getroffen wird. Beweist zwei
// Invarianten (Muster reservation-json-ephemeral.test.js, OUT-05): (1) ein Legacy-Store
// wirft NICHT beim Lesen ueber resolveTenant (Migration greift), (2) s.subIndex landet NIE
// auf der Platte, selbst nach einem vollen save() waehrend ein sub gebunden ist.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { tempDataDir, seedState } from "./helpers.js";

let store;
let file;

before(async () => {
  // seedState() liefert bewusst KEINEN subIndex-Key (Feld existiert dort nicht) ->
  // simuliert ein store.json, das vor tenant-prolif-b geschrieben wurde.
  const dataDir = tempDataDir(seedState({}));
  file = path.join(dataDir, "store.json");
  process.env.DATA_DIR = dataDir;
  store = await import("../src/store.js");
});

test("Migration: Legacy-Store ohne subIndex-Key wirft nicht, resolveTenant liefert null", () => {
  assert.equal(store.resolveTenant("ghost"), null, "state.subIndex ||= {} greift beim Lesen");
});

test("Ephemeralitaet: bindSubToTenant + save() schreibt subIndex NIE auf die Platte", () => {
  store.bindSubToTenant("s1", "t1");
  assert.equal(store.resolveTenant("s1"), "t1", "In-Prozess-Index bindet");

  store.save();
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal("subIndex" in onDisk, false, "subIndex ist strukturell von der Platte ausgeschlossen");
});
