import assert from "node:assert/strict";
import { test } from "node:test";

import { uebergabeEroeffnung } from "../../src/elevenlabs/uebergabe-override.js";

const OHNE_VORSPANN = [
  ["Dritter, gleiche Sprache: Eroeffnung nur in der Variable", { eroeffnung: "Guten Tag, KI.", perCallEroeffnung: "" }, { variable: "Guten Tag, KI.", agentFelder: {} }],
  ["Dritter, andere Sprache: Agent spricht die Eroeffnung selbst", { eroeffnung: "Hello, AI.", perCallEroeffnung: "Hello, AI." }, { variable: "Hello, AI.", agentFelder: { first_message: "Hello, AI." } }],
];
const MIT_VORSPANN = [
  ["Vorspann gesprochen, Eroeffnung des Agenten leer", { eroeffnungGesagt: "Guten Tag, KI.", eroeffnung: "Guten Tag, KI.", perCallEroeffnung: "" }],
  ["Vorspann gesprochen, Agent haette eigene Eroeffnung", { eroeffnungGesagt: "Hello, AI.", eroeffnung: "Hello, AI.", perCallEroeffnung: "Hello, AI." }],
];

for (const [fall, eingabe, erwartet] of OHNE_VORSPANN) {
  test(`5183-K3: ohne Vorspann bleibt die Eroeffnung unveraendert (${fall})`, () => {
    assert.deepEqual(uebergabeEroeffnung(eingabe), erwartet);
  });
}

for (const [fall, eingabe] of MIT_VORSPANN) {
  test(`5183-K3: ${fall}`, () => {
    assert.deepEqual(uebergabeEroeffnung(eingabe), { variable: "", agentFelder: { first_message: "" } });
  });
}
