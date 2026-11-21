import assert from "node:assert/strict";
import test from "node:test";

import { ANRUF_SPERRE_NAMENSRAUM, START_SPERRE_NAMENSRAUM } from "../../src/begriffe/speicher.js";
import { ANRUF_SPERREN_SQL } from "../anrufe/hermes-mit-postgres.js";
import { echteDatenbank } from "./echtes-postgres.js";

const SCHLUESSEL = 4711;
const NEHMEN_SQL = "SELECT pg_advisory_lock($1, $2)";
const GEBEN_SQL = "SELECT pg_advisory_unlock($1, $2)";
const anzahl = async (verbindung) => {
  const { rows } = await verbindung.query(ANRUF_SPERREN_SQL);
  return rows[0].anzahl;
};

test("Sperrenzaehlung: eine Sperre im Start-Namensraum zaehlt nicht, eine im Namensraum der Anrufsperre schon, bis sie frei ist", async (t) => {
  const db = await echteDatenbank(t);
  if (!db) return;
  const haelt = await db.verbinden();
  const zaehlt = await db.verbinden();
  await haelt.query(NEHMEN_SQL, [START_SPERRE_NAMENSRAUM, SCHLUESSEL]);
  assert.equal(await anzahl(zaehlt), 0);
  await haelt.query(NEHMEN_SQL, [ANRUF_SPERRE_NAMENSRAUM, SCHLUESSEL]);
  assert.equal(await anzahl(zaehlt), 1);
  await haelt.query(GEBEN_SQL, [ANRUF_SPERRE_NAMENSRAUM, SCHLUESSEL]);
  assert.equal(await anzahl(zaehlt), 0);
});
