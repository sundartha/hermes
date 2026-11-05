import assert from "node:assert/strict";
import { test } from "node:test";

import { BASIS, EXIT_ABBRUCH, NEGATIV, NULL, pruefe, quelle, testdatei } from "./mutationspruefung-hilfen.js";
import { probeRepository, writeFiles } from "./probe-repo.js";

const ABBRUCH = "Abbruch: Erstlauf rot: test/zahl.test.js › einordnen";
const MELDUNG = "Meldung des roten Tests: test/zahl.test.js › einordnen (Seite neu): Schlüssel fehlt: logRequestId";
const MUTANTENLAUF = /^src\/\w+\.js: \d+ Mutanten gegen \d+ Testdateien in \d+ s$/m;
const ZAHL_MIT_NULL = quelle(NEGATIV, NULL);
const ROTER_TEST = [
  'import { test } from "node:test";',
  'import "../src/zahl.js";',
  'test("einordnen", () => {',
  '  throw new Error("Schlüssel fehlt: logRequestId");',
  "});",
  "",
].join("\n");

function anfangstest() {
  return testdatei([-1, "negativ"], [1, "positiv"]).replace("../src/zahl.js", "../src/anfang.js");
}

function repoMitZweiQuelldateien(context) {
  const repo = probeRepository(context, { ...BASIS, "src/anfang.js": quelle(NEGATIV), "test/anfang.test.js": anfangstest() });
  writeFiles(repo, { "src/anfang.js": ZAHL_MIT_NULL, "src/zahl.js": ZAHL_MIT_NULL });
  return repo;
}

test("ein roter Test der zweiten Quelldatei bricht ab, bevor die erste Quelldatei mutiert wird, mit derselben Meldung", (context) => {
  const repo = repoMitZweiQuelldateien(context);
  writeFiles(repo, { "test/zahl.test.js": ROTER_TEST });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stderr.split("\n").includes(ABBRUCH), lauf.stderr);
  assert.ok(lauf.stderr.split("\n").includes(MELDUNG), lauf.stderr);
  assert.doesNotMatch(lauf.stdout, MUTANTENLAUF, "vor dem Abbruch lief schon ein Mutantenlauf");
});

test("sind alle Tests der Auswahl grün, werden beide Quelldateien wie bisher mutiert", (context) => {
  const lauf = pruefe(repoMitZweiQuelldateien(context), "--basis", "HEAD");
  assert.match(lauf.stdout, /^src\/anfang\.js: \d+ Mutanten gegen \d+ Testdateien in \d+ s$/m, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^src\/zahl\.js: \d+ Mutanten gegen \d+ Testdateien in \d+ s$/m, lauf.stdout + lauf.stderr);
});
