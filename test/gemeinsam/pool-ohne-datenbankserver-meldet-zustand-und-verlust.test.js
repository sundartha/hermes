import { test } from "node:test";
import assert from "node:assert/strict";

import { neuePglite } from "../pglite-helfer.js";
import { poolAufPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { fehlerausgabeVon } from "./fehlerausgabe.js";
import { hauptPoolOptionen } from "../../src/utils/pg-pool.js";
import { oeffneSpeicherAn } from "./speicher-oeffnen.js";

const WARTENDE_ANFRAGEN = 3;
const OFFENE_VERBINDUNGEN = 7;
const VERLUST_ZEILE = "[pool:haupt] Verbindung im Leerlauf verloren: terminating connection";

test("B8-Pool ohne Datenbankserver: der pg-Speicher meldet Warteschlange und offene Verbindungen seines Pools; ein Verlust im Leerlauf wird geloggt statt zu werfen", async () => {
  const pools = poolAufPglite(await neuePglite());
  process.env.STORE_BACKEND = "pg";
  process.env.DATABASE_URL = "postgres://attrappe.invalid/hermes";
  const speicher = await import("../../src/store.js").then(oeffneSpeicherAn);
  const [pool] = pools;
  assert.deepEqual(pool.optionen, hauptPoolOptionen("postgres://attrappe.invalid/hermes"));
  pool.waitingCount = WARTENDE_ANFRAGEN;
  pool.totalCount = OFFENE_VERBINDUNGEN;
  assert.deepEqual(speicher.poolZustand(), {
    wartend: WARTENDE_ANFRAGEN,
    offen: OFFENE_VERBINDUNGEN,
  });
  const zeilen = fehlerausgabeVon(() => pool.emit("error", new Error("terminating connection")));
  assert.deepEqual(zeilen, [VERLUST_ZEILE]);
});
