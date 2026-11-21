import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const karte = JSON.parse(readFileSync(fileURLToPath(new URL("../../tools/bereiche.json", import.meta.url)), "utf8"));

function treffer(bereich, liste, datei) {
  const eintrag = karte.find((e) => e.bereich === bereich);
  return eintrag[liste].some((muster) => new RegExp(muster).test(datei));
}

test("Bereichskarte: boot-guard ist Eingang im Bereich gemeinsam", () => {
  assert.equal(treffer("gemeinsam", "eingaenge", "src/boot-guard.ts"), true);
  assert.equal(treffer("gemeinsam", "fachlogik", "src/boot-guard.ts"), false);
});

test("Bereichskarte: boot-guard.ts waere ebenso Eingang", () => {
  assert.equal(treffer("gemeinsam", "eingaenge", "src/boot-guard.ts"), true);
});

test("Bereichskarte: boot-guard ist in keinem anderen Bereich erfasst", () => {
  const andere = karte.filter((e) => e.bereich !== "gemeinsam" && (treffer(e.bereich, "eingaenge", "src/boot-guard.ts") || treffer(e.bereich, "fachlogik", "src/boot-guard.ts")));
  assert.deepEqual(andere, []);
});

test("Bereichskarte: boot-guard-aehnliche Namen sind nicht erfasst", () => {
  assert.equal(treffer("gemeinsam", "eingaenge", "src/boot-guard-extra.js"), false);
});
