import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const karte = JSON.parse(readFileSync(fileURLToPath(new URL("../../tools/bereiche.json", import.meta.url)), "utf8"));

function treffer(bereich, liste, datei) {
  const eintrag = karte.find((e) => e.bereich === bereich);
  return eintrag[liste].some((muster) => new RegExp(muster).test(datei));
}

const NUMBERS = "src/telephony/adapters/telnyx/numbers.js";

test("Bereichskarte: telnyx numbers gehoert zu anrufe", () => {
  assert.equal(treffer("anrufe", "quellen", NUMBERS), true);
});

test("Bereichskarte: telnyx numbers nicht in nummern-quellen", () => {
  assert.equal(treffer("nummern", "quellen", NUMBERS), false);
});

test("Bereichskarte: telnyx numbers nicht in nummern-fachlogik", () => {
  assert.equal(treffer("nummern", "fachlogik", NUMBERS), false);
});

test("Bereichskarte: provisioning-geo bleibt in nummern", () => {
  assert.equal(treffer("nummern", "quellen", "src/telephony/provisioning-geo.ts"), true);
});
