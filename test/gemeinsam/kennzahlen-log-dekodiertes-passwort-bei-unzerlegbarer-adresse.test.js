import assert from "node:assert/strict";
import { test } from "node:test";

import {
  KENNZAHLEN_PASSWORT_UNZERLEGBAR_DEKODIERT,
  KENNZAHLEN_PASSWORT_UNZERLEGBAR_KODIERT,
} from "./erfundene-geheimnisse.js";
import { schreibeNachLauf } from "./kennzahlen-passwort-hilfen.js";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

await starteHermesMitPglite({
  alarmPostfach: "",
  ohneStartanruf: true,
  kennzahlenAdresse: `postgres://kennzahlen_leser:${KENNZAHLEN_PASSWORT_UNZERLEGBAR_KODIERT}@[::1/hermes`,
});

test("Das dekodierte Passwort einer nicht zerlegbaren Kennzahlen-Adresse steht in keiner Logzeile", async () => {
  const ausgabe = await schreibeNachLauf([`Passwort ${KENNZAHLEN_PASSWORT_UNZERLEGBAR_DEKODIERT} ende`]);
  assert.equal(ausgabe, "Passwort *** ende\n");
});
