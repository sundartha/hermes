import assert from "node:assert/strict";
import { test } from "node:test";

import { starteHermesMitPglite } from "./server-mit-testdatenbank.js";

const HTTP_BAD_GATEWAY = 502;
const AUFWAERM_ZIEL = "+4917312345680";

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "", vorspannWahlAbgelehnt: true, anrufwegWaermen: true });

test("aufbau-waermt-anrufpfad-vor: die Aufwärmanfrage kommt hinter den Gates beim Anbieter an und scheitert erst dort", () => {
  assert.equal(laufendesHermes().aufwaermStatus, HTTP_BAD_GATEWAY);
});

test("aufbau-waermt-anrufpfad-vor: der Aufbau hat vor der Rückgabe einen Anruf an das Aufwärmziel angelegt", async () => {
  const store = await import("../../src/store.js");
  const anrufe = store.load().calls.filter((anruf) => anruf.to === AUFWAERM_ZIEL);
  assert.equal(anrufe.length, 1);
  assert.equal(anrufe[0].direction, "outbound");
});

test("aufbau-waermt-anrufpfad-vor: die Betreibernummer wird nach der Aufwärmung nicht ein zweites Mal angelegt", async () => {
  await laufendesHermes().betreiberDarfAnrufen();
  const store = await import("../../src/store.js");
  const betreiberNummern = store.load().numbers.filter((nummer) => nummer.id === "num_kv2_betreiber");
  assert.equal(betreiberNummern.length, 1);
});
