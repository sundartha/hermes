import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { KENNZAHLEN_PASSWORT_LEERER_HOST } from "../gemeinsam/erfundene-geheimnisse.js";
import { schreibeNachLauf } from "../gemeinsam/kennzahlen-passwort-hilfen.js";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

await starteHermesMitPglite({
  alarmPostfach: "",
  ohneStartanruf: true,
  kennzahlenAdresse: `postgres://kennzahlen_leser:${KENNZAHLEN_PASSWORT_LEERER_HOST}@/hermes?host=/tmp`,
});

test("Eine Kennzahlen-Adresse mit leerem Host bricht den Lauf nicht an der Zerlegung ab", async () => {
  const zeilen = [];
  mock.method(console, "error", (...teile) => {
    zeilen.push(teile.join(" "));
  });
  const store = await import("../../src/store.js");
  await store.kennzahlenTakt();
  mock.restoreAll();
  assert.equal(zeilen.some((zeile) => zeile.includes("ERR_INVALID_URL")), false);
});

test("Das Passwort einer Kennzahlen-Adresse mit leerem Host steht in keiner Logzeile", async () => {
  const ausgabe = await schreibeNachLauf([`Passwort ${KENNZAHLEN_PASSWORT_LEERER_HOST} ende`]);
  assert.equal(ausgabe, "Passwort *** ende\n");
});
