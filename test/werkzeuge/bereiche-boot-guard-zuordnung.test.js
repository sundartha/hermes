import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const karte = JSON.parse(readFileSync(fileURLToPath(new URL("../../tools/bereiche.json", import.meta.url)), "utf8"));

function treffer(bereich, liste, datei) {
  const eintrag = karte.find((e) => e.bereich === bereich);
  return eintrag[liste].some((muster) => new RegExp(muster).test(datei));
}

test("Bereichskarte: boot-guard ist Fachlogik im Bereich gemeinsam", () => {
  assert.equal(treffer("gemeinsam", "fachlogik", "src/boot-guard.js"), true);
});

test("Bereichskarte: boot-guard.ts waere ebenso Fachlogik", () => {
  assert.equal(treffer("gemeinsam", "fachlogik", "src/boot-guard.ts"), true);
});

test("Bereichskarte: boot-guard ist in keinem anderen Bereich Fachlogik", () => {
  const andere = karte.filter((e) => e.bereich !== "gemeinsam" && treffer(e.bereich, "fachlogik", "src/boot-guard.js"));
  assert.deepEqual(andere, []);
});

test("Bereichskarte: boot-guard-aehnliche Namen sind nicht erfasst", () => {
  assert.equal(treffer("gemeinsam", "fachlogik", "src/boot-guard-extra.js"), false);
});
