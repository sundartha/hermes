import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CI = readFileSync(fileURLToPath(new URL("../../.github/workflows/ci.yml", import.meta.url)), "utf8");

function jobBlock(name) {
  const zeilen = CI.split("\n");
  const start = zeilen.findIndex((zeile) => zeile === `  ${name}:`);
  if (start < 0) return null;
  const ende = zeilen.findIndex((zeile, i) => i > start && /^ {2}\S/.test(zeile));
  return zeilen.slice(start, ende < 0 ? undefined : ende).join("\n");
}

function sammelNeeds() {
  const treffer = jobBlock("ci").match(/^ {4}needs: \[([^\]]*)\]/m);
  return treffer[1].split(",").map((eintrag) => eintrag.trim());
}

test("Die CI führt die Testsuite unter Node 26 aus, damit die Node-Erkennung die Zielversion findet", () => {
  const block = jobBlock("vorprobe-node26");
  assert.ok(block, "Job vorprobe-node26 fehlt");
  assert.match(block, /node-version: "26"/);
  assert.match(block, /npm test -- /);
  assert.match(block, /matrix:\s+teil: \[1, 2, 3, 4, 5, 6\]/);
  assert.match(block, /NR % 6 == teil % 6/);
  assert.match(CI, /(node-version:\s*["']?)26/);
});

test("Der Node-26-Lauf ist keine Pflicht: nicht in needs von ci, continue-on-error auf Job-Ebene", () => {
  const block = jobBlock("vorprobe-node26");
  assert.ok(block, "Job vorprobe-node26 fehlt");
  assert.match(block, /^ {4}continue-on-error: true$/m);
  assert.match(block, /^ {4}timeout-minutes: 20$/m);
  assert.equal(sammelNeeds().includes("vorprobe-node26"), false);
  assert.deepEqual(sammelNeeds(), ["pruefungen", "semgrep", "tests", "webtests", "rotprobe", "abdeckung", "mutation", "lastlauf"]);
});

test("Die Pflicht-Tests bleiben auf Node 22", () => {
  const block = jobBlock("tests");
  assert.doesNotMatch(block, /node-version/);
  assert.doesNotMatch(block, /continue-on-error/);
});
