import assert from "node:assert/strict";
import { test } from "node:test";

import { KENNZAHLEN_PASSWORT_UNZERLEGBAR } from "../gemeinsam/erfundene-geheimnisse.js";
import { schreibeNachLauf } from "../gemeinsam/kennzahlen-passwort-hilfen.js";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

const ADRESSE = `postgres://kennzahlen_leser:${KENNZAHLEN_PASSWORT_UNZERLEGBAR}@[::1/hermes`;

await starteHermesMitPglite({ alarmPostfach: "", ohneStartanruf: true, kennzahlenAdresse: ADRESSE });

test("Eine nicht zerlegbare Kennzahlen-Adresse steht als Ganzes in keiner Logzeile", async () => {
  const ausgabe = await schreibeNachLauf([`Fehler bei ${ADRESSE} ende`]);
  assert.equal(ausgabe, "Fehler bei *** ende\n");
});
