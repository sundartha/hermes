import assert from "node:assert/strict";
import { test } from "node:test";

import { starteHermesMitPglite } from "./server-mit-testdatenbank.js";

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "" });

test("aufbau-waermt-anrufpfad-vor: der Aufbau hat den Anrufweg vor der Rückgabe einmal ohne Anfragefrist durchlaufen", () => {
  const hermes = laufendesHermes();
  assert.deepEqual(hermes.aufwaermAnfragen, ["POST /api/calls"]);
});

test("aufbau-waermt-anrufpfad-vor: die Aufwärmanfrage ist vor der Rückgabe beantwortet", () => {
  const hermes = laufendesHermes();
  assert.equal(hermes.aufwaermStatus, 403);
});
