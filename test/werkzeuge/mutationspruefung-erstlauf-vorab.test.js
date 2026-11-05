import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { BASIS, EXIT_ABBRUCH, NEGATIV, NULL, pruefe, quelle, quelltexttest, testdatei } from "./mutationspruefung-hilfen.js";
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

const WOERTER = 'export const woerter = { hallo: "Hallo" };\n';
const ZWEI = 'export const zwei = "zwei";\n';
const ARTEFAKT = 'import { readFileSync } from "node:fs";\nexport const html = () => readFileSync(new URL("./woerter.js", import.meta.url), "utf8");\n';
const HALLO_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { woerter } from "../src/woerter.js";',
  'test("hallo", () => assert.equal(woerter.hallo, "Hallo"));',
  "",
].join("\n");
const ZWEI_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { zwei } from "../src/woerter.js";',
  'test("zwei", () => assert.equal(zwei, "zwei"));',
  "",
].join("\n");
const NUR_IN_DER_SANDBOX_ROT = "im Erstlauf nur in der Sandbox rot, ohne Sandbox grün";

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function hashTest(sollwert, name) {
  return [
    'import assert from "node:assert/strict";',
    'import { createHash } from "node:crypto";',
    'import { test } from "node:test";',
    'import "../src/woerter.js";',
    'import { html } from "../src/artefakt.js";',
    `test(${JSON.stringify(name)}, () => {`,
    `  assert.equal(createHash("sha256").update(html()).digest("hex"), ${JSON.stringify(sollwert)});`,
    "});",
    "",
  ].join("\n");
}

function repoMitHashTest(context, name) {
  const repo = probeRepository(context, {
    ...BASIS,
    "src/woerter.js": WOERTER,
    "src/artefakt.js": ARTEFAKT,
    "test/artefakt.test.js": hashTest(sha256(WOERTER), name),
    "test/woerter.test.js": HALLO_TEST,
  });
  writeFiles(repo, {
    "src/woerter.js": WOERTER + ZWEI,
    "src/zahl.js": ZAHL_MIT_NULL,
    "test/artefakt.test.js": hashTest(sha256(WOERTER + ZWEI), name),
    "test/zwei.test.js": ZWEI_TEST,
  });
  return repo;
}

test("ein Test, der im Vorab-Lauf nur in der Sandbox rot ist, bricht nicht ab, und beide Quelldateien werden mutiert", (context) => {
  const name = "Artefakt byte-identisch zum gepinnten Sollwert";
  const repo = repoMitHashTest(context, name);
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.doesNotMatch(lauf.stderr, /^Abbruch:/m, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stdout.split("\n").includes(`ohne test/artefakt.test.js › ${name}: ${NUR_IN_DER_SANDBOX_ROT}`), lauf.stdout);
  assert.match(lauf.stdout, /^src\/woerter\.js: \d+ Mutanten gegen \d+ Testdateien in \d+ s$/m, lauf.stdout);
  assert.match(lauf.stdout, /^src\/zahl\.js: \d+ Mutanten gegen \d+ Testdateien in \d+ s$/m, lauf.stdout);
});

test("ein roter Test, den die Prüfung für diese Quelldatei nur nachsichtig behandelt, bricht im Vorab-Lauf nicht ab", (context) => {
  const repo = repoMitZweiQuelldateien(context);
  writeFiles(repo, { "test/quelltext.test.js": quelltexttest("ist leer") });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.doesNotMatch(lauf.stderr, /^Abbruch:/m, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stdout.split("\n").includes("Zweite Stufe ohne test/quelltext.test.js › ist leer: im Erstlauf rot"), lauf.stdout);
  assert.match(lauf.stdout, /^src\/anfang\.js: \d+ Mutanten gegen \d+ Testdateien in \d+ s$/m, lauf.stdout);
  assert.match(lauf.stdout, /^src\/zahl\.js: \d+ Mutanten gegen \d+ Testdateien in \d+ s$/m, lauf.stdout);
});
