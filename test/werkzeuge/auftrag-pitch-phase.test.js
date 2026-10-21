import assert from "node:assert/strict";
import { test } from "node:test";

import { istPitchPhase } from "../../tools/auftrag/format.mjs";

test("P-001-x kommt aus einem Pitch", () => {
  assert.equal(istPitchPhase("P-001-x"), true);
});

test("p-001 in Kleinschreibung kommt aus einem Pitch", () => {
  assert.equal(istPitchPhase("p-001"), true);
});

test("P001 ohne Bindestrich kommt nicht aus einem Pitch", () => {
  assert.equal(istPitchPhase("P001"), false);
});

test("XP-1 mit P- nicht am Anfang kommt nicht aus einem Pitch", () => {
  assert.equal(istPitchPhase("XP-1"), false);
});

test("a10 kommt nicht aus einem Pitch", () => {
  assert.equal(istPitchPhase("a10"), false);
});

test("eine Zahl kommt nicht aus einem Pitch", () => {
  assert.equal(istPitchPhase(10), false);
});

test("undefined kommt nicht aus einem Pitch", () => {
  assert.equal(istPitchPhase(undefined), false);
});
