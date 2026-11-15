import assert from "node:assert/strict";
import { test } from "node:test";

import { KENNZAHLEN_PASSWORT_OHNE_SCHEMA } from "../gemeinsam/erfundene-geheimnisse.js";
import { schreibeNachLauf } from "../gemeinsam/kennzahlen-passwort-hilfen.js";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

await starteHermesMitPglite({
  alarmPostfach: "",
  ohneStartanruf: true,
  kennzahlenAdresse: `kennzahlen-attrappe.invalid/hermes?password=${KENNZAHLEN_PASSWORT_OHNE_SCHEMA}`,
});

test("Eine Kennzahlen-Adresse ganz ohne Schema bricht den Start nicht ab und maskiert keinen Text", async () => {
  const ausgabe = await schreibeNachLauf(["Stryker was here! plan"]);
  assert.equal(ausgabe, "Stryker was here! plan\n");
});

test("Das Passwort einer Kennzahlen-Adresse ohne Schema steht in keiner Logzeile", async () => {
  const ausgabe = await schreibeNachLauf([`Passwort ${KENNZAHLEN_PASSWORT_OHNE_SCHEMA} ende`]);
  assert.equal(ausgabe, "Passwort *** ende\n");
});
