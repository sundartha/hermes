import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { wertAnPfad } from "../../scripts/lib/elevenlabs-besitz.mjs";

const vorlage = JSON.parse(readFileSync(new URL("../../elevenlabs/agent_configs/outbound-agent.template.json", import.meta.url), "utf8"));

const ERÖFFNUNG_ZEICHEN = 183;
const LANGSAMSTE_INTAKTE_ZEICHEN_JE_SEKUNDE = 17.6;
const KARENZ_SEKUNDEN = 5;
const WARTEZEIT_PFAD = "agent.conversation_config.turn.initial_wait_time";

const bruecke = (zeichen) => zeichen / LANGSAMSTE_INTAKTE_ZEICHEN_JE_SEKUNDE + KARENZ_SEKUNDEN;

test("6161-A1 Rechnung: 183 Zeichen mit 17,6 Zeichen/s plus 5 s Karenz sind 15,4 Sekunden", () => {
  assert.equal(bruecke(ERÖFFNUNG_ZEICHEN).toFixed(1), "15.4");
});

test("6161-A2 Vorlage: initial_wait_time endet nach der Brücke einer 183-Zeichen-Eröffnung", () => {
  const treffer = wertAnPfad(vorlage, WARTEZEIT_PFAD);
  assert.equal(treffer.gefunden, true);
  assert.ok(treffer.wert >= bruecke(ERÖFFNUNG_ZEICHEN), `initial_wait_time ${treffer.wert} s endet vor der Brücke`);
});

test("6161-A3 Vorlage: initial_wait_time ist die aufgerundete Brücke von 16 Sekunden", () => {
  assert.equal(wertAnPfad(vorlage, WARTEZEIT_PFAD).wert, Math.ceil(bruecke(ERÖFFNUNG_ZEICHEN)));
});
