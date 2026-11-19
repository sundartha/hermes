import assert from "node:assert/strict";
import { test } from "node:test";

import { warteAufAnspruchsverbindung } from "./anspruchsverbindung.js";

const BEGINN = "BEGIN";
const ZEITGRENZE = "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)";
const KONTEXT = "SELECT set_config('app.current_tenant', $1, true)";
const ANSPRUCH = "UPDATE call SET el_nachlauf_started_at = now() WHERE id = $1";
const HOECHSTDAUER = "UPDATE call SET frist_hoechstdauer_at = $3 WHERE tenant_id = $1 AND id = $2";
const FAELLIG = "WITH faellig AS (SELECT id FROM call WHERE frist_hoechstdauer_at < now()) SELECT id FROM faellig";
const ABSCHLUSS = "COMMIT";
const ZURUECK = "ROLLBACK";
const GEHALTEN = [0, 1];
const VORHER = [0, 0];

const mitschnittAus = (verbindungen) => ({
  verbindungen: () => verbindungen,
  bisBedingung: async (bedingung) => assert.ok(bedingung(), JSON.stringify(verbindungen)),
});

const ergebnis = (verbindungen) => warteAufAnspruchsverbindung(mitschnittAus(verbindungen), VORHER, GEHALTEN);

test("Echter Anspruch mit Zeitgrenze, Mandanten-Kontext, UPDATE und COMMIT ist Anspruchsverbindung", async () => {
  const anspruch = [BEGINN, ZEITGRENZE, KONTEXT, ANSPRUCH, ABSCHLUSS];
  const takt = [BEGINN, KONTEXT, HOECHSTDAUER, ABSCHLUSS];
  assert.deepEqual(await ergebnis([takt, anspruch]), [1]);
});

test("Verbindung mit Kontext und Höchstdauer-UPDATE bleibt Takt", async () => {
  const takt = [BEGINN, KONTEXT, HOECHSTDAUER, ABSCHLUSS];
  assert.deepEqual(await ergebnis([takt, [BEGINN, ZURUECK]]), [1]);
});

test("Verbindung mit Kontext und Fristen-Abfrage bleibt Takt", async () => {
  const takt = [BEGINN, KONTEXT, FAELLIG, ABSCHLUSS];
  assert.deepEqual(await ergebnis([[BEGINN, ZURUECK], takt]), [0]);
});

test("Zwei Verbindungen mit nur ROLLBACK sind beide Anspruchsverbindungen", async () => {
  assert.deepEqual(await ergebnis([[BEGINN, ZURUECK], [BEGINN, ZURUECK]]), [0, 1]);
});
