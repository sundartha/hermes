import assert from "node:assert/strict";
import { test } from "node:test";

import { schreibeNachLauf } from "../gemeinsam/kennzahlen-passwort-hilfen.js";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

await starteHermesMitPglite({
  alarmPostfach: "",
  ohneStartanruf: true,
  kennzahlenAdresse: "postgres://kennzahlen_leser:a&b@kennzahlen-attrappe.invalid/hermes",
});

test("Ein Passwort mit und-Zeichen wird ganz maskiert, nicht sein erster Buchstabe", async () => {
  const ausgabe = await schreibeNachLauf(["Passwort a&b ende", "alle Daten"]);
  assert.equal(ausgabe, "Passwort *** ende\nalle Daten\n");
});
