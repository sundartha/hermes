import assert from "node:assert/strict";
import { test } from "node:test";

import { anweisungenBisZurueck, warteAufAnspruchsabschnitt } from "./anspruchsverbindung-abschnitt.js";

const ANSPRUCH = "UPDATE call SET el_nachlauf_started_at = now()";
const TAKT = "WITH faellig AS (SELECT 1)";
const ZEITGRENZE = "SELECT set_config('statement_timeout', '5s', true)";

function mitschnittAus(verbindungen) {
  return { verbindungen: () => verbindungen, bisBedingung: async (bedingung) => assert.ok(bedingung()) };
}

test("Der Abschnitt reicht von vorher bis einschliesslich zum ersten ROLLBACK", () => {
  const mitschnitt = mitschnittAus([["alt", "ROLLBACK", ZEITGRENZE, "ROLLBACK", TAKT]]);
  assert.deepEqual(anweisungenBisZurueck(mitschnitt, 0, [1]), ["ROLLBACK"]);
  assert.deepEqual(anweisungenBisZurueck(mitschnitt, 0, [2]), [ZEITGRENZE, "ROLLBACK"]);
});

test("Ohne ROLLBACK reicht der Abschnitt bis zum Ende", () => {
  const mitschnitt = mitschnittAus([["alt", ZEITGRENZE, ANSPRUCH]]);
  assert.deepEqual(anweisungenBisZurueck(mitschnitt, 0, [1]), [ZEITGRENZE, ANSPRUCH]);
});

test("Eine Takt-Anweisung nach dem ROLLBACK macht die Anspruchsverbindung nicht zum Takt", async () => {
  const mitschnitt = mitschnittAus([["alt", ZEITGRENZE, ANSPRUCH, "ROLLBACK", TAKT], ["alt", TAKT]]);
  assert.deepEqual(await warteAufAnspruchsabschnitt(mitschnitt, [1, 1], [0, 1]), [0]);
});
