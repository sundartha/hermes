import assert from "node:assert/strict";
import { test } from "node:test";

import { KENNZAHLEN_PASSWORT_SONDERZEICHEN, KENNZAHLEN_PASSWORT_SONDERZEICHEN_KODIERT } from "./erfundene-geheimnisse.js";
import { schreibeNachLauf, starteMitKennzahlenPasswort } from "./kennzahlen-passwort-hilfen.js";

await starteMitKennzahlenPasswort(KENNZAHLEN_PASSWORT_SONDERZEICHEN_KODIERT);

test("S29: Ein Passwort mit Sonderzeichen steht weder dekodiert noch prozentkodiert in einer Logzeile", async () => {
  const adresse = `postgres://kennzahlen_leser:${KENNZAHLEN_PASSWORT_SONDERZEICHEN_KODIERT}@kennzahlen-attrappe.invalid/hermes`;
  const ausgabe = await schreibeNachLauf([`connect ECONNREFUSED ${adresse}`, `Passwort ${KENNZAHLEN_PASSWORT_SONDERZEICHEN}`]);
  assert.ok(ausgabe.includes("kennzahlen_leser"));
  assert.equal(ausgabe.includes(KENNZAHLEN_PASSWORT_SONDERZEICHEN), false);
  assert.equal(ausgabe.includes(KENNZAHLEN_PASSWORT_SONDERZEICHEN_KODIERT), false);
});
