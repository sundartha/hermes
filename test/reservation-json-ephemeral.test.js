import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { tempDataDir, seedState } from "./helpers.js";

const TENANT = "tenant_ephemeral_1";

let store;
let dataDir;
let file;

before(async () => {
  dataDir = tempDataDir(seedState({}));
  file = path.join(dataDir, "store.json");
  process.env.DATA_DIR = dataDir;
  store = await import("../src/store.js");
});

test("Migration: Legacy-Store ohne reservations-Key wirft nicht, Reserve liest 0", () => {
  assert.equal(store.reservationOf(TENANT), 0, "state.reservations ||= {} greift beim Lesen");
});

test("Ephemeralitaet: save() waehrend gebuchter Reserve schreibt reservations NIE auf die Platte", async () => {
  const granted = await store.withStoreLock(() =>
    store.tryReserveOutboundBudget(TENANT, 60, { platformSpendCapCents: 10000 }),
  );
  assert.equal(granted, true, "Reserve wird gebucht (weit unter dem 100-EUR-Cap)");

  store.save();
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal("reservations" in onDisk, false, "reservations-Key ist strukturell von der Platte ausgeschlossen");

  assert.equal(store.reservationOf(TENANT), 60, "In-Prozess-Ledger bleibt trotz save() korrekt");

  store.releaseOutboundReserve({ tenantId: TENANT, reserveCents: 60, reserveReleased: false });
});
