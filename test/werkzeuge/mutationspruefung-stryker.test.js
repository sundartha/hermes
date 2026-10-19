import assert from "node:assert/strict";
import { test } from "node:test";

import { ABGESCHALTET, ABSCHALTEN_NAECHSTE, AKTIVER_MUTANT, ALLES_ABGESCHALTET, BASIS, EXIT_ROT, FREMDE_KONFIGURATION, NEGATIV, NULL, pruefe, quelle, schluessel, testdatei, UEBERLEBT, UMGEBUNGSTEST, ZUSTAND, zustandstest } from "./mutationspruefung-hilfen.js";
import { probeRepository, writeFiles } from "./probe-repo.js";

test("ein neuer Kommentar Stryker disable ist ein Verstoß und schaltet die Mutanten der nächsten Zeile nicht ab", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, ABSCHALTEN_NAECHSTE, NULL) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  const verstoesse = schluessel(rot.stdout, UEBERLEBT);
  assert.ok(verstoesse.includes("src/zahl.js:3 Kommentar „Stryker disable“"), rot.stdout);
  assert.ok(verstoesse.some((mutant) => mutant.startsWith("src/zahl.js:4:")), rot.stdout);
  assert.deepEqual(schluessel(rot.stdout, ABGESCHALTET), verstoesse);
  writeFiles(repo, {
    "src/zahl.js": quelle(NEGATIV, NULL),
    "test/zahl.test.js": testdatei([-1, "negativ"], [0, "null"], [1, "positiv"]),
  });
  const gruen = pruefe(repo, "--basis", "HEAD");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
});

test("ein neuer Kommentar Stryker disable bleibt ein Verstoß, auch wenn der Syntaxbaum gleich bleibt", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(ABSCHALTEN_NAECHSTE, NEGATIV) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.ok(schluessel(rot.stdout, UEBERLEBT).includes("src/zahl.js:2 Kommentar „Stryker disable“"), rot.stdout);
});

test("ein bestehender Blockkommentar Stryker disable schaltet die neuen Zeilen nicht ab", (context) => {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": ALLES_ABGESCHALTET + quelle(NEGATIV) });
  writeFiles(repo, { "src/zahl.js": ALLES_ABGESCHALTET + quelle(NEGATIV, NULL) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  const verstoesse = schluessel(rot.stdout, UEBERLEBT);
  assert.ok(verstoesse.length > 0 && verstoesse.every((mutant) => mutant.startsWith("src/zahl.js:4:")), rot.stdout);
  assert.deepEqual(schluessel(rot.stdout, ABGESCHALTET), verstoesse);
});

test("eine fremde Stryker-Konfigurationsdatei im Repo schaltet keine Mutanten ab", (context) => {
  const repo = probeRepository(context, { ...BASIS, ...FREMDE_KONFIGURATION });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  const verstoesse = schluessel(rot.stdout, UEBERLEBT);
  assert.ok(verstoesse.length > 0 && verstoesse.every((mutant) => mutant.startsWith("src/zahl.js:3:")), rot.stdout);
  assert.deepEqual(schluessel(rot.stdout, ABGESCHALTET), []);
});

test("eine neue Zeile, die Strykers Zustand abfragt, ist ein Verstoß, eine bestehende nicht", (context) => {
  const bestehend = { "test/helfer.js": `export const mutantenlauf = () => process.env.${AKTIVER_MUTANT} !== undefined;\n` };
  const repo = probeRepository(context, { ...BASIS, ...bestehend });
  writeFiles(repo, {
    "src/zahl.js": quelle(NEGATIV, NULL),
    "test/zustand.test.js": zustandstest(`process.env.${AKTIVER_MUTANT} !== undefined`),
  });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.deepEqual(schluessel(rot.stdout, ZUSTAND), ["test/zustand.test.js:5"]);
  assert.deepEqual(schluessel(rot.stdout, UEBERLEBT), []);
  assert.match(rot.stdout, /^rot: 1 neue Zeilen fragen Strykers Zustand ab; \d+ Mutanten in den neuen Zeilen unter src\/, keiner überlebt\.$/m);
  writeFiles(repo, { "test/zustand.test.js": testdatei([0, "null"]) });
  const gruen = pruefe(repo, "--basis", "HEAD");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
  assert.deepEqual(schluessel(gruen.stdout, ZUSTAND), []);
});

test("eine neue Zeile außerhalb von src/ und test/, die Strykers Zustand abfragt, ist ein Verstoß, in der Mutationsprüfung selbst nicht", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, {
    "src/zahl.js": quelle(NEGATIV, NULL),
    "scripts/umgebung.mjs": `export const gewohnt = () => process.env.${AKTIVER_MUTANT} === undefined;\n`,
    "tools/mutationspruefung/merkmal.mjs": `export const MERKMAL = "${AKTIVER_MUTANT}";\n`,
    "test/umgebung.test.js": UMGEBUNGSTEST,
  });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.deepEqual(schluessel(rot.stdout, ZUSTAND), ["scripts/umgebung.mjs:1"]);
  assert.deepEqual(schluessel(rot.stdout, UEBERLEBT), []);
});

test("die Stryker-Attrappe der Ausmist-Tests ist kein Verstoß, dieselbe Zeile in jeder anderen Testdatei schon", (context) => {
  const ersatz = ["STRY", "KER_ERSATZ"].join("");
  const zeile = `export const regeln = (env) => env.${ersatz};\n`;
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, {
    "test/werkzeuge/ausmisten/stryker-ersatz.mjs": zeile,
    "test/werkzeuge/ausmisten/totcode.mjs": zeile,
  });
  const gruen = pruefe(repo, "--basis", "HEAD");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
  assert.deepEqual(schluessel(gruen.stdout, ZUSTAND), []);
  writeFiles(repo, {
    "test/werkzeuge/ausmisten/regeln.mjs": zeile,
    "test/werkzeuge/ausmisten-totcode.test.js": zeile,
    "test/werkzeuge/stryker-ersatz.mjs": zeile,
    "test/ausmisten/totcode.mjs": zeile,
  });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.deepEqual(schluessel(rot.stdout, ZUSTAND).sort(), [
    "test/ausmisten/totcode.mjs:1",
    "test/werkzeuge/ausmisten-totcode.test.js:1",
    "test/werkzeuge/ausmisten/regeln.mjs:1",
    "test/werkzeuge/stryker-ersatz.mjs:1",
  ]);
});
