import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const text = readFileSync(".github/workflows/staging.yml", "utf8");
const jobs = text.slice(text.indexOf("\njobs:\n"));
const job = jobs.slice(jobs.indexOf("  staging:\n"), jobs.indexOf("  lastlauf:\n"));

test("der Staging-Job installiert die Pakete mit npm ci vor der Prüfung", () => {
  const installation = job.indexOf("uses: ./.github/actions/node-npm-ci");
  assert.ok(installation > 0);
  assert.ok(installation < job.indexOf("- name: Staging abwarten und prüfen"));
  assert.match(job, /node-npm-ci\n\s+with:\n\s+web: "false"/);
});

test("die Installation steht vor der Anrufprobe und dem Beenden offener Probe-Anrufe", () => {
  const installation = job.indexOf("uses: ./.github/actions/node-npm-ci");
  assert.ok(installation < job.indexOf("- name: Anrufprobe"));
  assert.ok(installation < job.indexOf("- name: Offene Probe-Anrufe beenden"));
});

test("der Job richtet Node nicht mehr ohne Installation ein", () => {
  assert.doesNotMatch(job, /uses: actions\/setup-node@/);
});

test("die Installation steht genau einmal im Staging-Job", () => {
  assert.equal(job.match(/node-npm-ci/g).length, 1);
});
