import assert from "node:assert/strict";
import { test } from "node:test";

import { KENNZAHLEN_PASSWORT_ABFRAGE, KENNZAHLEN_PASSWORT_ABFRAGE_KODIERT } from "../gemeinsam/erfundene-geheimnisse.js";
import { schreibeNachLauf } from "../gemeinsam/kennzahlen-passwort-hilfen.js";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

await starteHermesMitPglite({
  alarmPostfach: "",
  ohneStartanruf: true,
  kennzahlenAdresse: `postgres://kennzahlen_leser@kennzahlen-attrappe.invalid/hermes?password=${KENNZAHLEN_PASSWORT_ABFRAGE_KODIERT}`,
});

test("Das Passwort aus dem Abfrageteil der Kennzahlen-Adresse steht in keiner Logzeile", async () => {
  const ausgabe = await schreibeNachLauf([
    `Passwort ${KENNZAHLEN_PASSWORT_ABFRAGE} ende`,
    `Roh ${KENNZAHLEN_PASSWORT_ABFRAGE_KODIERT} ende`,
  ]);
  assert.equal(ausgabe, "Passwort *** ende\nRoh *** ende\n");
});
