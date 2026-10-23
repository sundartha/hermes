import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BASIS, NEGATIV, NULL, quelle, testdatei } from "./mutationspruefung-hilfen.js";
import { probeDirectory, probeRepository, REPO_ROOT, writeFiles } from "./probe-repo.js";
import { umgebung } from "./schwerlauf-lauf.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const ERSATZ = fileURLToPath(new URL("mutationspruefung-arbeitsprozesse-ersatz.mjs", import.meta.url));
const KONFIGURIERT = JSON.parse(readFileSync(join(REPO_ROOT, "stryker.config.json"), "utf8")).concurrency;
const PLAETZE = 2;

function arbeitsprozesse(context, { kerne, ci }) {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL), "test/zahl.test.js": testdatei([-1, "negativ"], [0, "null"], [1, "positiv"]) });
  const protokoll = join(probeDirectory(context, {}), "arbeitsprozesse");
  const env = { ...umgebung(context, PLAETZE), KERNE: String(kerne), ARBEITSPROZESSE: protokoll };
  delete env.CI;
  if (ci) env.CI = "true";
  const lauf = spawnSync(process.execPath, ["--import", ERSATZ, WERKZEUG, "--basis", "HEAD"], { cwd: repo, encoding: "utf8", env });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  return [...new Set(readFileSync(protokoll, "utf8").trim().split("\n").map(Number))];
}

test("lokal auf einer Maschine mit vielen Kernen arbeitet die Mutationsprüfung mit Kernen geteilt durch Plätze der Schwerlauf-Sperre", (context) => {
  assert.deepEqual(arbeitsprozesse(context, { kerne: 64, ci: false }), [64 / PLAETZE]);
});

test("lokal mit wenigen Kernen arbeitet die Mutationsprüfung mit mindestens dem Wert aus stryker.config.json", (context) => {
  assert.deepEqual(arbeitsprozesse(context, { kerne: 2, ci: false }), [KONFIGURIERT]);
});

test("in der CI arbeitet die Mutationsprüfung auch mit vielen Kernen genau mit dem Wert aus stryker.config.json", (context) => {
  assert.deepEqual(arbeitsprozesse(context, { kerne: 64, ci: true }), [KONFIGURIERT]);
});
