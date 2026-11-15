import assert from "node:assert/strict";
import { test } from "node:test";

import { schreibeNachLauf } from "../gemeinsam/kennzahlen-passwort-hilfen.js";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

await starteHermesMitPglite({
  alarmPostfach: "",
  ohneStartanruf: true,
  kennzahlenAdresse: "postgres://kennzahlen_leser:p@ss@kennzahlen-attrappe.invalid/hermes",
});

test("Ein Passwort mit at-Zeichen wird ganz maskiert, nicht sein Präfix", async () => {
  const ausgabe = await schreibeNachLauf(["Passwort p@ss ende", "plan passt"]);
  assert.equal(ausgabe, "Passwort *** ende\nplan passt\n");
});
