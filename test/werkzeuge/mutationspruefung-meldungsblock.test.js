import assert from "node:assert/strict";
import { test } from "node:test";

import { BASIS, EXIT_ABBRUCH, EXIT_ROT, mitProtokoll, NEGATIV, NULL, PROTOKOLL, protokolltest, pruefe, quelle } from "./mutationspruefung-hilfen.js";
import { probeRepository, writeFiles } from "./probe-repo.js";

const BLOCK = "Meldungsblock | ";
const JE_FALL_ZEILEN = 40;
const JE_FALL_ZEICHEN = 4000;
const GESAMT_ZEILEN = 100;
const VERLANGT_PROTOKOLL = protokolltest('assert.equal(zahl.einordnen(-1), "negativ");', "assert.deepEqual(zahl.protokoll, [-1]);");
const MIT_NULL = { "src/zahl.js": quelle(NEGATIV, NULL) };

function roterFall(name, meldung) {
  return `test("${name}", () => {\n  throw new Error(${JSON.stringify(meldung)});\n});\n`;
}

function roteDatei(faelle) {
  return ['import { test } from "node:test";', 'import "../src/zahl.js";', ...faelle.map(([name, meldung]) => roterFall(name, meldung)), ""].join("\n");
}

function nurAusserhalbDerSandboxRot(name) {
  const meldung = zeilenFolge(JE_FALL_ZEILEN * 2, name);
  return `import { test } from "node:test";\nimport "../src/zahl.js";\ntest("${name}", () => {\n  if (!process.cwd().includes("sandbox")) throw new Error(${JSON.stringify(meldung)});\n});\n`;
}

function blockzeilen(lauf) {
  return lauf.stderr.split("\n").filter((zeile) => zeile.startsWith(BLOCK));
}

function rotesProbeRepo(context, faelle) {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { ...MIT_NULL, "test/zahl.test.js": roteDatei(faelle) });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  return lauf;
}

function zeilenFolge(anzahl, vorsatz) {
  return Array.from({ length: anzahl }, (_, index) => `${vorsatz} ${index + 1}`).join("\n");
}

test("ein roter Erstlauf nennt die ganze mehrzeilige Fehlermeldung des Falls und nicht nur ihre erste Zeile", (context) => {
  const lauf = rotesProbeRepo(context, [["einordnen", "Befehl fehlgeschlagen: git rev-parse HEAD\nfatal: not a git repository (or any of the parent directories): .git\nletzte Zeile"]]);
  assert.deepEqual(blockzeilen(lauf), [
    `${BLOCK}Befehl fehlgeschlagen: git rev-parse HEAD`,
    `${BLOCK}fatal: not a git repository (or any of the parent directories): .git`,
    `${BLOCK}letzte Zeile`,
  ], lauf.stderr);
});

test("ein roter Erstlauf kürzt die Fehlermeldung eines Falls auf 40 Zeilen und sagt, wie viele fehlen", (context) => {
  const lauf = rotesProbeRepo(context, [["einordnen", zeilenFolge(100, "Zeile")]]);
  const zeilen = blockzeilen(lauf);
  assert.equal(zeilen.length, JE_FALL_ZEILEN, lauf.stderr);
  assert.equal(zeilen[0], `${BLOCK}Zeile 1`);
  assert.equal(zeilen.at(-1), `${BLOCK}… 61 weitere Zeilen weggelassen`);
});

test("ein roter Erstlauf kürzt die Fehlermeldung eines Falls auf 4000 Zeichen", (context) => {
  const lauf = rotesProbeRepo(context, [["einordnen", `Anfang\n${"x".repeat(JE_FALL_ZEICHEN * 3)}`]]);
  const zeilen = blockzeilen(lauf);
  assert.equal(zeilen[0], `${BLOCK}Anfang`);
  assert.ok(zeilen.join("").length <= JE_FALL_ZEICHEN + zeilen.length * BLOCK.length, lauf.stderr.slice(0, 500));
  assert.ok(zeilen.at(-1).endsWith("…"), zeilen.at(-1).slice(-50));
});

test("ein roter Erstlauf lässt ganze Zeilen weg, sobald die 4000 Zeichen voll sind, und nennt ihre Zahl", (context) => {
  const lauf = rotesProbeRepo(context, [["einordnen", Array.from({ length: 10 }, () => "x".repeat(JE_FALL_ZEICHEN / 4)).join("\n")]]);
  const zeilen = blockzeilen(lauf);
  assert.equal(zeilen.length, 5, lauf.stderr.slice(0, 500));
  assert.equal(zeilen.at(-1), `${BLOCK}… 6 weitere Zeilen weggelassen`);
});

test("ein im Grundlauf der Löschprobe roter Fall nennt seine Fehlermeldung, mehrere zusammen höchstens 100 Zeilen", (context) => {
  const faelle = ["drei", "eins", "vier", "zwei"];
  const tests = Object.fromEntries(faelle.map((name) => [`test/${name}.test.js`, nurAusserhalbDerSandboxRot(name)]));
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": mitProtokoll(quelle(NEGATIV)), "test/zahl.test.js": VERLANGT_PROTOKOLL, ...tests });
  writeFiles(repo, { "src/zahl.js": mitProtokoll(quelle(PROTOKOLL, NEGATIV)) });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  const zeilen = blockzeilen(lauf);
  assert.equal(zeilen.length, GESAMT_ZEILEN, lauf.stderr);
  for (const name of faelle.slice(0, 3)) assert.ok(zeilen.includes(`${BLOCK}${name} 1`), `${name} fehlt`);
  assert.equal(zeilen.some((zeile) => zeile.startsWith(`${BLOCK}zwei`)), false, "der vierte Fall findet keinen Platz mehr");
});

const SANDBOX_MELDUNG = "Befehl fehlgeschlagen: git rev-parse HEAD\nfatal: not a git repository (or any of the parent directories): .git\nletzte Zeile";

function nurInDerSandboxRot(name, meldung, ortsteil = "sandbox") {
  return `import { test } from "node:test";\nimport "../src/zahl.js";\ntest("${name}", () => {\n  if (process.cwd().includes("${ortsteil}")) throw new Error(${JSON.stringify(meldung)});\n});\n`;
}

test("ein nur in der Sandbox roter Fall im Erstlauf nennt die Fehlermeldung aus dem roten Sandbox-Lauf", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { ...MIT_NULL, "test/zahl.test.js": nurInDerSandboxRot("einordnen", SANDBOX_MELDUNG) });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual(blockzeilen(lauf), SANDBOX_MELDUNG.split("\n").map((zeile) => `${BLOCK}${zeile}`), lauf.stderr);
});

test("ein nur in der Sandbox roter Fall im Grundlauf der Löschprobe nennt die Fehlermeldung aus dem roten Sandbox-Lauf", (context) => {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": mitProtokoll(quelle(NEGATIV)), "test/zahl.test.js": VERLANGT_PROTOKOLL, "test/eins.test.js": nurInDerSandboxRot("eins", SANDBOX_MELDUNG, "loeschprobe") });
  writeFiles(repo, { "src/zahl.js": mitProtokoll(quelle(PROTOKOLL, NEGATIV)) });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.deepEqual(blockzeilen(lauf), SANDBOX_MELDUNG.split("\n").map((zeile) => `${BLOCK}${zeile}`), lauf.stdout + lauf.stderr);
});
