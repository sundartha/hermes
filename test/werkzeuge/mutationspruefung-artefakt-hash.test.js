import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BASIS, EXIT_ABBRUCH, EXIT_ROT, pruefe, schluessel, UEBERLEBT } from "./mutationspruefung-hilfen.js";
import { isolatedEnvironment, probeRepository, REPO_ROOT, writeFiles } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const ERSATZ = fileURLToPath(new URL("mutationspruefung-artefakt-hash-ersatz.mjs", import.meta.url));
const HAENGER_FRIST_MS = 120_000;

const WOERTER = 'export const woerter = { hallo: "Hallo" };\n';
const ZWEI = 'export const zwei = "zwei";\n';
const HALLO_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { woerter } from "../src/woerter.js";',
  'test("hallo", () => {',
  '  assert.equal(woerter.hallo, "Hallo");',
  "});",
  "",
].join("\n");
const ARTEFAKT = 'import { readFileSync } from "node:fs";\nexport const html = () => readFileSync(new URL("./woerter.js", import.meta.url), "utf8");\n';
const HASH_TEST = "Artefakt byte-identisch zum gepinnten Sollwert";
const GRUND = "im Erstlauf nur in der Sandbox rot, ohne Sandbox grün";
const OHNE_AUSGABE = `ohne test/artefakt.test.js › ${HASH_TEST}: ${GRUND}`;
const ABBRUCH_HASH = `Abbruch: Erstlauf rot: test/artefakt.test.js › ${HASH_TEST}`;
const GRUPPE = "Gruppe";
const VERSCHACHTELT = `${GRUPPE} > ${HASH_TEST}`;
const OHNE_VERSCHACHTELT = `ohne test/artefakt.test.js › ${VERSCHACHTELT}: ${GRUND}`;
const PIN_TEST = "Karte trägt den Pin des ausgelieferten Artefakts";
const OHNE_PIN = `ohne test/pin.test.js › ${PIN_TEST}: ${GRUND}`;
const ABBRUCH_PIN = `Abbruch: Erstlauf rot: test/pin.test.js › ${PIN_TEST}`;
const ABBRUCH_ROT = "Abbruch: Erstlauf rot: test/rot.test.js › kaputt";
const FALSCHER_SOLLWERT = "0".repeat(64);

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function hashTest(sollwert, { name = HASH_TEST, gruppe } = {}) {
  const pruefung = [`test(${JSON.stringify(name)}, () => {`, `  assert.equal(createHash("sha256").update(html()).digest("hex"), ${JSON.stringify(sollwert)});`, "});"];
  return [
    'import assert from "node:assert/strict";',
    'import { createHash } from "node:crypto";',
    'import { describe, test } from "node:test";',
    'import "../src/woerter.js";',
    'import { html } from "../src/artefakt.js";',
    ...(gruppe === undefined ? pruefung : [`describe(${JSON.stringify(gruppe)}, () => {`, ...pruefung, "});"]),
    "",
  ].join("\n");
}

function pinTest() {
  return [
    'import assert from "node:assert/strict";',
    'import { createHash } from "node:crypto";',
    'import { readFileSync } from "node:fs";',
    'import { test } from "node:test";',
    'import "../src/woerter.js";',
    'import { html } from "../src/artefakt.js";',
    `test(${JSON.stringify(PIN_TEST)}, () => {`,
    '  const karte = JSON.parse(readFileSync(new URL("./pin.json", import.meta.url), "utf8"));',
    '  assert.deepEqual({ version: karte.version, pin: createHash("sha256").update(html()).digest("hex").slice(0, 16) }, karte);',
    "});",
    "",
  ].join("\n");
}

function pinDatei(text) {
  return `${JSON.stringify({ version: 2, pin: sha256(text).slice(0, 16) })}\n`;
}

function pinRepo(context, { pin, nach }) {
  const repo = probeRepository(context, {
    ...BASIS,
    "src/woerter.js": WOERTER,
    "src/artefakt.js": ARTEFAKT,
    "test/pin.test.js": pinTest(),
    "test/pin.json": pinDatei(WOERTER),
    "test/woerter.test.js": HALLO_TEST,
  });
  writeFiles(repo, { "src/woerter.js": WOERTER + ZWEI, "test/pin.json": pin, ...nach });
  return repo;
}

function zweiTest(prueft) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { zwei } from "../src/woerter.js";',
    'test("zwei", () => {',
    prueft ? '  assert.equal(zwei, "zwei");' : "  void zwei;",
    "});",
    "",
  ].join("\n");
}

function artefaktRepo(context, nach) {
  const repo = probeRepository(context, {
    ...BASIS,
    "src/woerter.js": WOERTER,
    "src/artefakt.js": ARTEFAKT,
    "test/artefakt.test.js": hashTest(sha256(WOERTER)),
    "test/woerter.test.js": HALLO_TEST,
  });
  writeFiles(repo, {
    "src/woerter.js": WOERTER + ZWEI,
    "test/artefakt.test.js": hashTest(sha256(WOERTER + ZWEI)),
    ...nach,
  });
  return repo;
}

test("ein Test mit festem Artefakt-Hash, der nur in der Sandbox rot ist, wird ausgelassen, die übrigen Tests bewerten die Mutanten", (context) => {
  const repo = artefaktRepo(context, { "test/zwei.test.js": zweiTest(true) });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stdout.split("\n").includes(OHNE_AUSGABE), lauf.stdout);
  assert.doesNotMatch(lauf.stderr, /^Abbruch:/m);
  assert.deepEqual(schluessel(lauf.stdout, UEBERLEBT), []);
});

test("ein Mutant, den nur der Hash-Test töten würde, überlebt und macht die Prüfung rot", (context) => {
  const repo = artefaktRepo(context, { "test/zwei.test.js": zweiTest(false) });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stdout.split("\n").includes(OHNE_AUSGABE), lauf.stdout);
  assert.ok(schluessel(lauf.stdout, UEBERLEBT).some((mutant) => mutant.startsWith("src/woerter.js:2:")), lauf.stdout);
});

test("ein anderer roter Erstlauf-Test ohne festen Artefakt-Hash bricht weiter ab, auch neben einem Hash-Test", (context) => {
  const kaputt = 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport "../src/woerter.js";\ntest("kaputt", () => {\n  assert.equal(1 + 1, 3);\n});\n';
  const repo = artefaktRepo(context, { "test/zwei.test.js": zweiTest(true), "test/rot.test.js": kaputt });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stderr.split("\n").includes(ABBRUCH_ROT), lauf.stderr);
});

test("ein Hash-Test, der auch im unveränderten Stand rot ist, bricht weiter ab", (context) => {
  const repo = artefaktRepo(context, { "test/zwei.test.js": zweiTest(true), "test/artefakt.test.js": hashTest(FALSCHER_SOLLWERT) });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stderr.split("\n").includes(ABBRUCH_HASH), lauf.stderr);
  assert.doesNotMatch(lauf.stdout, /^ohne test\//m);
});

test("ein gleichnamiger zweiter Test lässt den Hash-Test nicht aus, weil die Auslassung auch ihn träfe", (context) => {
  const gleichnamig = ['import { test } from "node:test";', 'import "../src/woerter.js";', `test(${JSON.stringify(HASH_TEST)}, () => {});`, ""].join("\n");
  const repo = artefaktRepo(context, { "test/zwei.test.js": zweiTest(true), "test/gleichnamig.test.js": gleichnamig });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stderr.split("\n").includes(ABBRUCH_HASH), lauf.stderr);
});

const ZUR_LAUFZEIT = [
  ['import { test } from "node:test";', 'import "../src/woerter.js";', 'const teile = ["Artefakt byte-identisch", "zum gepinnten Sollwert"];', "test(`${teile.join(\" \")}`, () => {});", ""],
  ['import { test } from "node:test";', 'import "../src/woerter.js";', 'const NAME = "Artefakt byte-identisch zum gepinnten Sollwert";', "test(NAME, () => {});", ""],
  ['import { test } from "node:test";', 'import "../src/woerter.js";', 'test("Artefakt byte-identisch " + "zum gepinnten Sollwert", () => {});', ""],
  ['import { test } from "node:test";', 'import "../src/woerter.js";', 'test("Artefakt byte-identisch zum gepinnten Soll\\u0077ert", () => {});', ""],
  ['import { it } from "node:test";', 'import "../src/woerter.js";', 'it(`${"Artefakt byte-identisch zum gepinnten Soll"}wert`, () => {});', ""],
];

for (const [index, zeilen] of ZUR_LAUFZEIT.entries()) {
  test(`ein zur Laufzeit gebildeter gleichnamiger Test (Fall ${index + 1}) lässt den Hash-Test nicht aus`, (context) => {
    const repo = artefaktRepo(context, { "test/zwei.test.js": zweiTest(true), "test/laufzeit.test.js": zeilen.join("\n") });
    const lauf = pruefe(repo, "--basis", "HEAD");
    assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
    assert.ok(lauf.stderr.split("\n").includes(ABBRUCH_HASH), lauf.stderr);
  });
}

test("ein verschachtelter Hash-Test wird ausgelassen", (context) => {
  const sollwert = sha256(WOERTER + ZWEI);
  const repo = artefaktRepo(context, { "test/zwei.test.js": zweiTest(true), "test/artefakt.test.js": hashTest(sollwert, { gruppe: GRUPPE }) });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stdout.split("\n").includes(OHNE_VERSCHACHTELT), lauf.stdout);
});

test("ein oberster Test mit dem zusammengesetzten Namen eines verschachtelten Hash-Tests lässt ihn nicht aus", (context) => {
  const sollwert = sha256(WOERTER + ZWEI);
  const gleichnamig = ['import { test } from "node:test";', 'import "../src/woerter.js";', `test(${JSON.stringify(`${GRUPPE} ${HASH_TEST}`)}, () => {});`, ""].join("\n");
  const repo = artefaktRepo(context, { "test/zwei.test.js": zweiTest(true), "test/artefakt.test.js": hashTest(sollwert, { gruppe: GRUPPE }), "test/gleichnamig.test.js": gleichnamig });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stderr.split("\n").includes(`Abbruch: Erstlauf rot: test/artefakt.test.js › ${VERSCHACHTELT}`), lauf.stderr);
});

function haengt() {
  return ['import { test } from "node:test";', 'import "../src/woerter.js";', 'if (!process.cwd().includes("sandbox")) setInterval(() => {}, 1000);', 'test("haengt", () => {});', ""].join("\n");
}

test("eine fremde Testdatei, die ohne Sandbox nicht endet, geht nicht in die Gegenprobe ein und hält sie nicht auf", (context) => {
  const repo = artefaktRepo(context, { "test/zwei.test.js": zweiTest(true), "test/haengt.test.js": haengt() });
  const lauf = spawnSync(process.execPath, ["--import", ERSATZ, WERKZEUG, "--basis", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
    env: isolatedEnvironment(),
    timeout: HAENGER_FRIST_MS,
  });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stdout.split("\n").includes(OHNE_AUSGABE), lauf.stdout);
  assert.doesNotMatch(lauf.stderr, /^Gegenprobe ohne Sandbox:/m);
});

test("ein Test, der einen berechneten Pin vergleicht und nur in der Sandbox rot ist, wird ausgelassen, die übrigen Tests bewerten die Mutanten", (context) => {
  const repo = pinRepo(context, { pin: pinDatei(WOERTER + ZWEI), nach: { "test/zwei.test.js": zweiTest(true) } });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stdout.split("\n").includes(OHNE_PIN), lauf.stdout);
  assert.doesNotMatch(lauf.stderr, /^Abbruch:/m);
  assert.deepEqual(schluessel(lauf.stdout, UEBERLEBT), []);
});

test("ein Test mit berechnetem Pin, der auch ohne Sandbox rot ist, bricht weiter ab", (context) => {
  const repo = pinRepo(context, { pin: pinDatei("anderer Stand"), nach: { "test/zwei.test.js": zweiTest(true) } });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stderr.split("\n").includes(ABBRUCH_PIN), lauf.stderr);
  assert.doesNotMatch(lauf.stdout, /^ohne test\//m);
});
