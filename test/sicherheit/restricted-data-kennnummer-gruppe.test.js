import assert from "node:assert/strict";
import { test } from "node:test";

import { findRestrictedData, maskRestrictedText } from "../../src/restricted-data.ts";

const DREIZEHN_GRUPPEN = "1 2 3 4 5 6 7 8 9 1 2 3 4";

function ausweisTreffer(text) {
  return findRestrictedData(text)
    .filter((hit) => hit.category === "government_id")
    .map((hit) => text.slice(hit.start, hit.end));
}

test("Kennnummer mit Label und einer Wertgruppe: genau der Wert ist gesperrt, nicht das Label", () => {
  assert.deepEqual(ausweisTreffer("ssn: 123456"), ["123456"]);
  assert.equal(maskRestrictedText("ssn: 123456"), "ssn: [restricted-government-id]");
});

test("Kennnummer mit zwölf Zusatzgruppen: alle dreizehn Gruppen sind gesperrt", () => {
  assert.deepEqual(ausweisTreffer(`ssn: ${DREIZEHN_GRUPPEN}`), [DREIZEHN_GRUPPEN]);
  assert.equal(maskRestrictedText(`ssn: ${DREIZEHN_GRUPPEN}`), "ssn: [restricted-government-id]");
});

test("Kennnummer mit mehr als zwölf Zusatzgruppen: die vierzehnte Gruppe bleibt offen", () => {
  assert.equal(maskRestrictedText(`ssn: ${DREIZEHN_GRUPPEN} 5`), "ssn: [restricted-government-id] 5");
});
