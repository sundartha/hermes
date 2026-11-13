import assert from "node:assert/strict";
import { test } from "node:test";

import { KENNZAHLEN_PASSWORT_NICHT_DEKODIERBAR } from "./erfundene-geheimnisse.js";
import { schreibeNachLauf, starteMitKennzahlenPasswort } from "./kennzahlen-passwort-hilfen.js";

await starteMitKennzahlenPasswort(KENNZAHLEN_PASSWORT_NICHT_DEKODIERBAR);

test("Ein Passwort mit ungültiger Prozentfolge steht roh in keiner Logzeile", async () => {
  const ausgabe = await schreibeNachLauf([`Passwort ${KENNZAHLEN_PASSWORT_NICHT_DEKODIERBAR} ende`]);
  assert.equal(ausgabe, "Passwort *** ende\n");
});
