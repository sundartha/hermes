import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BASIS, EXIT_ABBRUCH, NEGATIV, NULL, quelle, testdatei } from "./mutationspruefung-hilfen.js";
import { isolatedEnvironment, probeRepository, REPO_ROOT, writeFiles } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const ERSATZ = fileURLToPath(new URL("mutationspruefung-zeitgrenze-ersatz.mjs", import.meta.url));
const ZWEITE_TESTDATEI = "test/zahl-zwei.test.js";
const ABBRUCH_ZEITGRENZE = /^Abbruch: Erstlauf über der Zeitgrenze: (.+)$/gm;

function probe(context, tests = {}) {
  const repo = probeRepository(context, { ...BASIS, ...tests });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  return repo;
}

function mitZeitgrenze(repo, umgebung) {
  return spawnSync(process.execPath, ["--import", ERSATZ, WERKZEUG, "--basis", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...isolatedEnvironment(), ...umgebung },
  });
}

function abbruchzeilen(ausgabe) {
  return [...ausgabe.matchAll(ABBRUCH_ZEITGRENZE)].map(([, datei]) => datei);
}

test("zwei Testdateien über der Zeitgrenze werden in zwei Teilen geprüft und die Teile vereint, ohne Abbruchzeile", (context) => {
  const repo = probe(context, { [ZWEITE_TESTDATEI]: testdatei([1, "positiv"]) });
  const lauf = mitZeitgrenze(repo, { ZEITGRENZE_AB: "1" });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^src\/zahl\.js: Erstlauf über der Zeitgrenze, 2 Testdateien in 2 Teilen geprüft$/m);
  assert.deepEqual(abbruchzeilen(lauf.stderr), []);
});

test("eine einzelne Testdatei über der Zeitgrenze bricht ab und nennt die Datei", (context) => {
  const lauf = mitZeitgrenze(probe(context), { ZEITGRENZE_AB: "0" });
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.deepEqual(abbruchzeilen(lauf.stderr), ["test/zahl.test.js"]);
});

test("meldet der Erstlauf neben der Zeitgrenze einen Fehler-Status, bricht er ab, ohne eine Zeitgrenze zu nennen", (context) => {
  const lauf = mitZeitgrenze(probe(context), { ZEITGRENZE_AB: "0", ZEITGRENZE_FEHLER: "1" });
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.deepEqual(abbruchzeilen(lauf.stderr), []);
  assert.match(lauf.stderr, /^Abbruch: Something went wrong in the initial test run$/m);
});
