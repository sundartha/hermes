import { test } from "node:test";
import assert from "node:assert/strict";
import { webhookEvents } from "../src/telephony/registry.js";
import { PROVIDER } from "../src/store/defaults.js";

const FAELLE = [
  ["Status vorhanden", { data: { payload: { status: "completed" } } }, "completed"],
  ["anderer Status", { data: { payload: { status: "file_not_found" } } }, "file_not_found"],
  ["Status fehlt", { data: { payload: {} } }, null],
  ["Payload fehlt", { data: {} }, null],
  ["Daten fehlen", {}, null],
  ["kein Koerper", undefined, null],
];

test("Telnyx Wiedergabe-Status: nur ein vorhandener Status wird gelesen, fehlende Teile ergeben null", () => {
  for (const [name, koerper, erwartet] of FAELLE) {
    assert.equal(webhookEvents(PROVIDER.TELNYX).parseWiedergabeStatus(koerper), erwartet, name);
  }
});
