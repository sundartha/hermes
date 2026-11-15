import assert from "node:assert/strict";
import { test } from "node:test";

import { schreibeNachLauf } from "../gemeinsam/kennzahlen-passwort-hilfen.js";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

await starteHermesMitPglite({
  alarmPostfach: "",
  ohneStartanruf: true,
  kennzahlenAdresse: "/x://kennzahlen_leser:plan@kennzahlen-attrappe.invalid/hermes",
});

test("Eine Adresse ohne Schema am Anfang liefert kein Passwort, das Wort plan bleibt lesbar", async () => {
  const ausgabe = await schreibeNachLauf(["plan passt"]);
  assert.equal(ausgabe, "plan passt\n");
});
