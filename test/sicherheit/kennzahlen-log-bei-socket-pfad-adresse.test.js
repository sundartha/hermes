import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

await starteHermesMitPglite({
  alarmPostfach: "",
  ohneStartanruf: true,
  kennzahlenAdresse: "/tmp hermes",
});

test("Eine Kennzahlen-Adresse als Socket-Pfad bricht den Lauf nicht an der Zerlegung ab", async () => {
  const zeilen = [];
  mock.method(console, "error", (...teile) => {
    zeilen.push(teile.join(" "));
  });
  const store = await import("../../src/store.js");
  await store.kennzahlenTakt();
  mock.restoreAll();
  assert.equal(zeilen.some((zeile) => zeile.includes("ERR_INVALID_URL")), false);
});
