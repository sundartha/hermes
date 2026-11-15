import { test } from "node:test";
import assert from "node:assert/strict";

import { echteDatenbank } from "./echtes-postgres.js";
import { fehlerausgabeVonAsync } from "./fehlerausgabe.js";
import { oeffneSpeicherAn } from "./speicher-oeffnen.js";

const WARTE_FRIST_MS = 10_000;
const VERLUST_ZEILE = "[pool:haupt] Verbindung im Leerlauf verloren:";
const ALLE_ANDEREN_VERBINDUNGEN =
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()";

async function bisErfuellt(bedingung) {
  const frist = AbortSignal.timeout(WARTE_FRIST_MS);
  while (!frist.aborted) {
    if (bedingung()) return true;
    await new Promise((fertig) => setImmediate(fertig));
  }
  return false;
}

test("B8-Pool: der Speicher meldet den Pool; verlorene Leerlauf-Verbindungen werden geloggt statt den Prozess zu stuerzen", async (t) => {
  const db = await echteDatenbank(t);
  if (!db) return;
  process.env.STORE_BACKEND = "pg";
  process.env.DATABASE_URL = db.adresse;
  const speicher = await import("../../src/store.js").then(oeffneSpeicherAn);
  const zustand = speicher.poolZustand();
  assert.equal(zustand.wartend, 0);
  assert.ok(zustand.offen >= 1);
  const verbindung = await db.verbinden();
  const zeilen = await fehlerausgabeVonAsync(async () => {
    await verbindung.query(ALLE_ANDEREN_VERBINDUNGEN);
    await bisErfuellt(() => speicher.poolZustand().offen === 0);
  });
  assert.ok(zeilen.some((zeile) => zeile.startsWith(VERLUST_ZEILE)));
  assert.equal(speicher.poolZustand().offen, 0);
});
