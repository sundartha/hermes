import assert from "node:assert/strict";
import { test } from "node:test";

import { schreibeNachLauf } from "./kennzahlen-passwort-hilfen.js";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

await starteHermesMitPglite({
  alarmPostfach: "",
  ohneStartanruf: true,
  kennzahlenAdresse: "postgres://kennzahlen_leser@kennzahlen-attrappe.invalid/hermes",
});

test("Eine Kennzahlen-Adresse ohne Passwort maskiert das Wort undefined in Logzeilen nicht", async () => {
  const ausgabe = await schreibeNachLauf(["Wert undefined ende"]);
  assert.equal(ausgabe, "Wert undefined ende\n");
});
