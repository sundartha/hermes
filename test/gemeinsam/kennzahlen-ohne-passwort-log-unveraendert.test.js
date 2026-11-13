import assert from "node:assert/strict";
import { test } from "node:test";

import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { schreibeNachLauf } from "./kennzahlen-passwort-hilfen.js";

await starteHermesMitPglite({
  alarmPostfach: "",
  ohneStartanruf: true,
  kennzahlenAdresse: "postgres://kennzahlen_leser@kennzahlen-attrappe.invalid/hermes",
});

test("Eine Kennzahlen-Adresse ohne Passwort lässt Logzeilen unverändert", async () => {
  const ausgabe = await schreibeNachLauf(["Anrufe heute 12 ende"]);
  assert.equal(ausgabe, "Anrufe heute 12 ende\n");
});
