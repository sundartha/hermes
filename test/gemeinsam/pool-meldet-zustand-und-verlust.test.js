import { test } from "node:test";
import assert from "node:assert/strict";

import { echteDatenbank } from "./echtes-postgres.js";
import { echtWarten } from "../echt-warten.js";
import { fehlerausgabeVonAsync } from "./fehlerausgabe.js";

const ABFRAGE_PAUSE_MS = 20;
const ABFRAGE_VERSUCHE = 100;
const VERLUST_ZEILE = "[pool] Verbindung im Leerlauf verloren:";
const ALLE_ANDEREN_VERBINDUNGEN =
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()";

async function bisErfuellt(bedingung) {
  for (let versuch = 0; versuch < ABFRAGE_VERSUCHE; versuch += 1) {
    if (bedingung()) return true;
    await echtWarten(ABFRAGE_PAUSE_MS);
  }
  return false;
}

test("B8-Pool: der Speicher meldet den Pool; verlorene Leerlauf-Verbindungen werden geloggt statt den Prozess zu stuerzen", async (t) => {
  const db = await echteDatenbank(t);
  if (!db) return;
  process.env.STORE_BACKEND = "pg";
  process.env.DATABASE_URL = db.adresse;
  const speicher = await import("../../src/store.js");
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
