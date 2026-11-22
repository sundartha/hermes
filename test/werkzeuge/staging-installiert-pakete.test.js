import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const WORKFLOW = readFileSync(new URL("../../.github/workflows/staging.yml", import.meta.url), "utf8");

function jobBlock(job) {
  return WORKFLOW.match(new RegExp(`^  ${job}:\\n([\\s\\S]*?)(?=^  [a-z]+:\\n|(?![\\s\\S]))`, "m"))[1];
}

function schrittNamen(job) {
  return [...jobBlock(job).matchAll(/^      - name: (.+)$/gm)].map((m) => m[1]);
}

test("Staging-Job installiert die Pakete vor der Anrufprobe im selben Job", () => {
  const namen = schrittNamen("staging");
  const installieren = namen.findIndex((n) => n.includes("npm ci"));
  const probe = namen.findIndex((n) => n.startsWith("Anrufprobe"));
  assert.ok(installieren >= 0, "kein npm-ci-Schritt im Staging-Job");
  assert.ok(installieren < probe, "npm ci muss vor der Anrufprobe laufen");
  assert.ok(installieren < namen.findIndex((n) => n.startsWith("Offene Probe-Anrufe")));
  assert.match(
    jobBlock("staging"),
    /Node 22 und npm ci\n\s+uses: \.\/\.github\/actions\/node-npm-ci\n\s+with:\n\s+web: "false"/,
  );
});

test("Staging-Job nutzt kein einzelnes setup-node, und es gibt genau die Jobs staging und lastlauf", () => {
  assert.doesNotMatch(jobBlock("staging"), /actions\/setup-node/);
  const jobs = [...WORKFLOW.split(/^jobs:\n/m)[1].matchAll(/^  ([a-z]+):\n/gm)].map((m) => m[1]);
  assert.deepEqual(jobs, ["staging", "lastlauf"]);
});
