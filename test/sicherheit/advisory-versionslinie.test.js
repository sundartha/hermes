import assert from "node:assert/strict";
import { test } from "node:test";

import { echteQuellen } from "../../tools/freigabe.mjs";

const PULL = { number: 42, base: { ref: "master" } };

function eintrag(fix, bereich, { name = "ws", oekosystem = "npm" } = {}) {
  return { package: { ecosystem: oekosystem, name }, first_patched_version: fix, vulnerable_version_range: bereich };
}

const WS_LINIEN = [
  eintrag("5.2.5", ">= 5.0.0, < 5.2.5"),
  eintrag("6.2.4", ">= 6.0.0, < 6.2.4"),
  eintrag("7.5.11", ">= 7.0.0, < 7.5.11"),
  eintrag("8.21.0", ">= 8.0.0, < 8.21.0"),
];

async function ersterFix(alt, neu, { vulnerabilities = WS_LINIEN, felder = {} } = {}) {
  const vorher = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{ withdrawn_at: null, vulnerabilities, ...felder }]), { status: 200 });
  try {
    return await echteQuellen(PULL, "d".repeat(40)).ersterFix({ oekosystem: "npm", name: "ws", alt, neu });
  } finally {
    globalThis.fetch = vorher;
  }
}

test("ws 7.5.0 auf die 8.21.0 ist kein erster Fix, die Linie 7 hat die 7.5.11", async () => {
  assert.equal(await ersterFix("7.5.0", "8.21.0"), false);
});

test("ws 7.5.0 auf die 7.5.11 ist der erste Fix", async () => {
  assert.equal(await ersterFix("7.5.0", "7.5.11"), true);
});

test("ws 8.1.0 auf die 8.21.0 ist der erste Fix der Linie 8", async () => {
  assert.equal(await ersterFix("8.1.0", "8.21.0"), true);
});

test("ein alter Stand außerhalb jeder verwundbaren Spanne hat keinen Fix", async () => {
  assert.equal(await ersterFix("9.0.0", "8.21.0"), false);
  assert.equal(await ersterFix("4.9.9", "5.2.5"), false);
});

const SPANNEN = [
  ["< 2.0.0", "1.9.9", true],
  ["< 2.0.0", "2.0.0", false],
  ["<= 2.0.0", "2.0.0", true],
  ["<= 2.0.0", "2.0.1", false],
  ["> 2.0.0", "2.0.1", true],
  ["> 2.0.0", "2.0.0", false],
  [">= 2.0.0", "2.0.0", true],
  [">= 2.0.0", "1.9.9", false],
  ["= 2.0.0", "2.0.0", true],
  ["= 2.0.0", "2.0.1", false],
  [">= 1.0.0, < 1.10.0", "1.9.0", true],
  [">= 1.0.0, < 1.10.0", "1.10.0", false],
  [">= 1.0.0, < 1.10.0", "0.9.0", false],
  ["< 1.10.0", "1.9.99", true],
];

for (const [bereich, alt, erwartet] of SPANNEN) {
  test(`Spanne "${bereich}" auf ${alt} ergibt ${erwartet}`, async () => {
    assert.equal(await ersterFix(alt, "3.0.0", { vulnerabilities: [eintrag("3.0.0", bereich)] }), erwartet);
  });
}

test("ein Eintrag ohne Spanne zählt wie bisher", async () => {
  assert.equal(await ersterFix("1.0.0", "3.0.0", { vulnerabilities: [eintrag("3.0.0", undefined)] }), true);
});

test("eine zurückgezogene Advisory zählt nicht", async () => {
  assert.equal(await ersterFix("7.5.0", "7.5.11", { felder: { withdrawn_at: "2026-11-01T00:00:00Z" } }), false);
});

test("Einträge fremder Pakete und Ökosysteme zählen nicht", async () => {
  assert.equal(await ersterFix("7.5.0", "7.5.11", { vulnerabilities: [eintrag("7.5.11", ">= 7.0.0, < 7.5.11", { name: "anders" })] }), false);
  assert.equal(await ersterFix("7.5.0", "7.5.11", { vulnerabilities: [eintrag("7.5.11", ">= 7.0.0, < 7.5.11", { oekosystem: "pip" })] }), false);
});
