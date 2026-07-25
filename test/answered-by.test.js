// GAP-21: classifyAnsweredBy ist die EINE Klassifikations-Quelle (G5) fuer beide
// Provider-Adapter. fail-open pro Zweig: ALLES ausser den fuenf eindeutigen Maschinen-
// Token (+ fax) -> UNKNOWN, NIE MACHINE - ein leise/langsam antwortender Mensch darf nie
// aufgelegt bekommen (Pre-Mortem 3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ANSWERED_BY, classifyAnsweredBy } from "../src/telephony/answered-by.js";

test("eindeutige Maschinen-Token -> MACHINE", () => {
  for (const token of [
    "machine_start",
    "machine_end_beep",
    "machine_end_silence",
    "machine_end_other",
    "fax",
  ]) {
    assert.equal(classifyAnsweredBy(token), ANSWERED_BY.MACHINE, `${token} muss MACHINE liefern`);
  }
});

test("human -> HUMAN", () => {
  assert.equal(classifyAnsweredBy("human"), ANSWERED_BY.HUMAN);
});

test("alles andere (fehlend/unbekannt) -> UNKNOWN (fail-open)", () => {
  for (const raw of ["", undefined, "weird", null, "MACHINE_START", 42, {}]) {
    assert.equal(classifyAnsweredBy(raw), ANSWERED_BY.UNKNOWN, `${JSON.stringify(raw)} muss UNKNOWN liefern`);
  }
});
