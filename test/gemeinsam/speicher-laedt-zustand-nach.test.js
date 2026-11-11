import { test } from "node:test";
import assert from "node:assert/strict";

import { oeffneSpeicherAn } from "./speicher-oeffnen.js";

const NUMMER = "+15005550006";
const MANDANT = "owner";
const ANBIETER = "telnyx";

process.env.STORE_BACKEND = "pg";
process.env.DATABASE_URL = "postgres://attrappe.invalid/hermes";
const { makePgTestStore } = await import("../pg-helpers.js");
const { poolAufPglite } = await import("../abrechnung/server-mit-testdatenbank.js");
const { store: andere, db } = await makePgTestStore();
poolAufPglite(db);
const speicher = await import("../../src/store.js").then(oeffneSpeicherAn);

test("pg-Speicher: zustandNachladen holt eine Nummer, die eine andere Instanz angelegt hat", async () => {
  assert.equal(speicher.load().numbers.length, 0);
  await andere.bootstrapTenant(NUMMER, MANDANT, ANBIETER);
  assert.equal(speicher.load().numbers.length, 0);
  await speicher.zustandNachladen();
  assert.deepEqual(
    speicher.load().numbers.map((nummer) => nummer.e164),
    [NUMMER],
  );
});
