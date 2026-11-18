import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const text = readFileSync(".github/workflows/staging.yml", "utf8");
const start = text.indexOf("\n  staging:\n");
const ende = text.indexOf("\n  lastlauf:\n", start);
const job = text.slice(start, ende);
const schritte = job.split(/\n {6}- /).slice(1);
const probe = schritte.filter((schritt) => /run: node scripts\/anruf-probe\/probe\.mjs$/m.test(schritt));

test("der Job staging führt die Anrufprobe als Schritt aus", () => {
  assert.ok(start > 0 && ende > start);
  assert.equal(probe.length, 1);
});

test("der Schritt der Anrufprobe trägt kein continue-on-error", () => {
  assert.doesNotMatch(probe[0], /continue-on-error/);
  assert.doesNotMatch(job.slice(0, job.indexOf("\n    steps:\n")), /continue-on-error/);
});
