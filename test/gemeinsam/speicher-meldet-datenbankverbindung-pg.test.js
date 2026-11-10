import { test } from "node:test";
import assert from "node:assert/strict";

import { neuePglite } from "../pglite-helfer.js";
import { poolAufPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { oeffneSpeicherAn } from "./speicher-oeffnen.js";

const POOL_ABGELEHNT = "keine Verbindung vom Pool";
const WARTENDE_ANFRAGEN = 2;
const OFFENE_VERBINDUNGEN = 4;
const PROBE_FEHLT = "Probe fehlt an der Fassade";

const pools = poolAufPglite(await neuePglite());
process.env.STORE_BACKEND = "pg";
process.env.DATABASE_URL = "postgres://attrappe.invalid/hermes";
const speicher = await import("../../src/store.js").then(oeffneSpeicherAn);
const [pool] = pools;

async function mitAbgelehnterVerbindung(aufruf) {
  const echteVerbindung = pool.connect;
  pool.connect = () => Promise.reject(new Error(POOL_ABGELEHNT));
  try {
    return await aufruf();
  } finally {
    pool.connect = echteVerbindung;
  }
}

test("pg-Speicher: die Verbindungsprobe liefert das Ergebnis von SELECT 1 und lehnt mit der Meldung des Pools ab", async () => {
  const antwort = await speicher.pruefeVerbindung();
  assert.deepEqual(antwort.rows, [{ "?column?": 1 }]);
  await mitAbgelehnterVerbindung(() =>
    assert.rejects(speicher.pruefeVerbindung(), { message: POOL_ABGELEHNT }),
  );
});

test("[NIE1] pg-Speicher: die Probe ist nie undefined und meldet bei abgelehnter Verbindung nie Erfolg", async () => {
  assert.equal(typeof speicher.pruefeVerbindung, "function", PROBE_FEHLT);
  assert.notEqual(await speicher.pruefeVerbindung(), undefined);
  const ergebnis = await mitAbgelehnterVerbindung(() =>
    speicher.pruefeVerbindung().then(
      () => "erfolg",
      (fehler) => fehler.message,
    ),
  );
  assert.equal(ergebnis, POOL_ABGELEHNT);
});

test("[NIE3] pg-Speicher: poolZustand meldet weiter den Zustand des Pools", () => {
  pool.waitingCount = WARTENDE_ANFRAGEN;
  pool.totalCount = OFFENE_VERBINDUNGEN;
  assert.deepEqual(speicher.poolZustand(), {
    wartend: WARTENDE_ANFRAGEN,
    offen: OFFENE_VERBINDUNGEN,
  });
});
