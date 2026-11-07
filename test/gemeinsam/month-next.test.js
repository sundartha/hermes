import assert from "node:assert/strict";
import { test } from "node:test";

import { nextMonthStart } from "../../src/utils/naechster-monat.js";

test("nextMonthStart: 31. Januar führt auf den 1. Februar", () => {
  assert.equal(nextMonthStart(new Date("2026-01-31T12:00:00Z")).toISOString(), "2026-02-01T00:00:00.000Z");
});

test("nextMonthStart: Dezember führt auf den 1. Januar des Folgejahres", () => {
  assert.equal(nextMonthStart(new Date("2026-12-15T00:00:00Z")).toISOString(), "2027-01-01T00:00:00.000Z");
});
