import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const CI = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const PFLICHT = ["pruefungen", "semgrep", "tests", "webtests"];

function jobNamen() {
  return [...CI.matchAll(/^ {2}([a-z]+):\n/gm)].map((treffer) => treffer[1]);
}

function sammelNeeds() {
  const treffer = CI.match(/^ {2}ci:\n[\s\S]*?^ {4}needs: \[([^\]]*)\]$/m);
  assert.ok(treffer, "Sammel-Job ci hat kein needs");
  return treffer[1].split(",").map((name) => name.trim());
}

function jqAuswahl() {
  const treffer = CI.match(/rot=\$\(jq -r '([^']+)' <<< "\$NEEDS"\)/);
  assert.ok(treffer, "jq-Auswahl des Sammel-Jobs fehlt");
  return treffer[1];
}

function sammelAusgabe(ergebnisse) {
  const needs = Object.fromEntries(sammelNeeds().map((name) => [name, { result: ergebnisse[name] ?? "success" }]));
  const lauf = spawnSync("jq", ["-r", jqAuswahl()], { input: JSON.stringify(needs), encoding: "utf8" });
  assert.equal(lauf.status, 0, lauf.stderr);
  return lauf.stdout.trim();
}

test("ci.yml hat keinen Job abdeckung und keinen Job mutation", () => {
  const namen = jobNamen();
  assert.ok(namen.includes("pruefungen"));
  assert.ok(!namen.includes("abdeckung"));
  assert.ok(!namen.includes("mutation"));
});

test("der Sammel-Job ci wartet auf die Pflicht-Jobs, rotprobe und lastlauf, nicht auf abdeckung und mutation", () => {
  assert.deepEqual(sammelNeeds(), [...PFLICHT, "rotprobe", "lastlauf"]);
  assert.ok(!jqAuswahl().includes("abdeckung"));
  assert.ok(!jqAuswahl().includes("mutation"));
});

test("ein roter oder fehlender Pflicht-Job macht ci rot, übersprungenes rotprobe und lastlauf nicht", () => {
  assert.equal(sammelAusgabe({ rotprobe: "skipped", lastlauf: "skipped" }), "");
  for (const job of PFLICHT) {
    assert.equal(sammelAusgabe({ [job]: "failure" }), `${job}: failure`);
    assert.equal(sammelAusgabe({ [job]: "skipped" }), `${job}: skipped`);
    assert.equal(sammelAusgabe({ [job]: "cancelled" }), `${job}: cancelled`);
  }
  assert.equal(sammelAusgabe({ rotprobe: "failure" }), "rotprobe: failure");
  assert.equal(sammelAusgabe({ lastlauf: "failure" }), "lastlauf: failure");
});
