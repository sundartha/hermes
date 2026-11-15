import assert from "node:assert/strict";
import { test } from "node:test";

import { schreibeNachLauf } from "../gemeinsam/kennzahlen-passwort-hilfen.js";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

await starteHermesMitPglite({
  alarmPostfach: "",
  ohneStartanruf: true,
  kennzahlenAdresse: "postgres://kennzahlen-attrappe.invalid:5432/hermes?password=a%40b",
});

test("Das Abfragepasswort ohne Benutzer wird maskiert, der Port bleibt sichtbar", async () => {
  const ausgabe = await schreibeNachLauf(["Roh a%40b ende", "Klar a@b ende", "host 5432 ok"]);
  assert.equal(ausgabe, "Roh *** ende\nKlar *** ende\nhost 5432 ok\n");
});
