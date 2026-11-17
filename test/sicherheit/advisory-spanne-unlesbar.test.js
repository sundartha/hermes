import assert from "node:assert/strict";
import { test } from "node:test";

import { echteQuellen } from "../../tools/freigabe.mjs";

const PULL = { number: 42, base: { ref: "master" } };

async function ersterFix(spanne, alt = "7.5.0") {
  const vorher = globalThis.fetch;
  const eintrag = { package: { ecosystem: "npm", name: "ws" }, first_patched_version: "7.5.11", vulnerable_version_range: spanne };
  globalThis.fetch = async () => new Response(JSON.stringify([{ withdrawn_at: null, vulnerabilities: [eintrag] }]), { status: 200 });
  try {
    return await echteQuellen(PULL, "d".repeat(40)).ersterFix({ oekosystem: "npm", name: "ws", alt, neu: "7.5.11" });
  } finally {
    globalThis.fetch = vorher;
  }
}

const FAELLE = [
  ["null", null, false],
  ["leerer Text", "", false],
  ["Text ohne Version", "unbekannt", false],
  ["ein lesbarer und ein unlesbarer Teil", ">= 7.0.0, ", false],
  ["Zahl statt Text", 7, false],
  ["gültige Spanne um den alten Stand", ">= 7.0.0, < 7.5.11", true],
  ["gültige Spanne neben dem alten Stand", "< 7.0.0", false],
];

for (const [name, spanne, erwartet] of FAELLE) {
  test(`Spanne ${name} liefert ${erwartet} statt eines Abbruchs`, async () => {
    assert.equal(await ersterFix(spanne), erwartet);
  });
}

test("ohne Spanne zählt der Eintrag weiter als Fix", async () => {
  assert.equal(await ersterFix(undefined), true);
});
