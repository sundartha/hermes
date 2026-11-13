import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { testschutzBefunde } from "../../tools/testschutz.mjs";

const ARBEITSVERZEICHNIS = process.cwd();

function gitUmgebung() {
  const umgebung = { ...process.env };
  for (const name of Object.keys(umgebung)) if (name.startsWith("GIT_")) delete umgebung[name];
  return umgebung;
}

function git(ordner, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: ordner, env: gitUmgebung(), encoding: "utf8" }).trim();
}

function schreibe(ordner, dateien) {
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
    writeFileSync(join(ordner, pfad), inhalt);
  }
}

function befunde(vorher, nachher, entfernt = []) {
  const ordner = mkdtempSync(join(tmpdir(), "testschutz-endung-"));
  try {
    git(ordner, "init", "-q");
    schreibe(ordner, vorher);
    git(ordner, "add", "--", ".");
    git(ordner, "commit", "-q", "-m", "basis");
    const basis = git(ordner, "rev-parse", "HEAD");
    for (const pfad of entfernt) rmSync(join(ordner, pfad));
    schreibe(ordner, nachher);
    git(ordner, "add", "--", ".");
    git(ordner, "commit", "-q", "-m", "kopf");
    const kopf = git(ordner, "rev-parse", "HEAD");
    process.chdir(ordner);
    return testschutzBefunde(basis, kopf);
  } finally {
    process.chdir(ARBEITSVERZEICHNIS);
    rmSync(ordner, { recursive: true, force: true });
  }
}

function einzeln(datei, vorher, nachher) {
  return befunde({ [datei]: `${vorher}\n` }, { [datei]: `${nachher}\n` });
}

const REINE_ENDUNG = [
  ['import x from "./a.js";', 'import x from "./a.ts";'],
  ['import { y } from "../a/b.js";', 'import { y } from "../a/b.ts";'],
  ['export * from "./a.js";', 'export * from "./a.ts";'],
  ['import "./a.js";', 'import "./a.ts";'],
  ['const m = await import("./a.js");', 'const m = await import("./a.ts");'],
  ['const m = require("./a.js");', 'const m = require("./a.ts");'],
];

for (const [alt, neu] of REINE_ENDUNG) {
  test(`SG-21 Testschutz: reine Importendung .js zu .ts ist kein Befund (${alt})`, () => {
    for (const datei of ["test/a.test.js", "test/a.test.mjs", "test/a.test.cjs", "test/a.test.ts"]) {
      assert.deepEqual(einzeln(datei, alt, neu), []);
    }
  });
}

test("SG-21 Testschutz: neben der Importendung geänderte Zeilen zählen einzeln", () => {
  const vorher = { "test/a.test.js": 'import x from "./a.js";\nconst a = 1;\nconst b = 2;\n' };
  const geaendert = befunde(vorher, { "test/a.test.js": 'import x from "./a.ts";\nconst a = 2;\nconst b = 2;\n' });
  assert.deepEqual(geaendert, ["test/a.test.js: 1 bestehende Zeilen geändert oder entfernt"]);
  const zeichen = befunde({ "test/a.test.js": 'import x from "./a.js";\n' }, { "test/a.test.js": 'import y from "./a.ts";\n' });
  assert.deepEqual(zeichen, ["test/a.test.js: 1 bestehende Zeilen geändert oder entfernt"]);
  const geloescht = befunde(vorher, { "test/a.test.js": 'import x from "./a.ts";\nconst b = 2;\n' });
  assert.deepEqual(geloescht, ["test/a.test.js: 2 bestehende Zeilen geändert oder entfernt"]);
  const zwei = befunde(vorher, { "test/a.test.js": 'import x from "./a.ts";\nconst a = 3;\nconst b = 4;\n' });
  assert.deepEqual(zwei, ["test/a.test.js: 2 bestehende Zeilen geändert oder entfernt"]);
});

const WEITERHIN_ROT = [
  ["anderer Pfad", 'import x from "./a.js";', 'import x from "./b.ts";'],
  ["mjs zu ts", 'import x from "./a.mjs";', 'import x from "./a.ts";'],
  ["cjs zu ts", 'import x from "./a.cjs";', 'import x from "./a.ts";'],
  ["json zu ts", 'import x from "./a.json";', 'import x from "./a.ts";'],
  ["ts zu js", 'import x from "./a.ts";', 'import x from "./a.js";'],
  ["Paketimport", 'import x from "pkg/a.js";', 'import x from "pkg/a.ts";'],
  ["node-Import", 'import x from "node:fs.js";', 'import x from "node:fs.ts";'],
  ["Zeichenkette ohne Importsyntax", 'assert.equal(x, "./a.js");', 'assert.equal(x, "./a.ts");'],
  ["nur einer von zwei Importen", 'import x from "./a.js"; import y from "./b.js";', 'import x from "./a.ts"; import y from "./b.js";'],
  ["zusätzlicher Text", 'import x from "./a.js";', 'import x from "./a.ts"; x();'],
];

for (const [name, alt, neu] of WEITERHIN_ROT) {
  test(`SG-21 Testschutz: ${name} bleibt ein Befund`, () => {
    assert.deepEqual(einzeln("test/a.test.js", alt, neu), ["test/a.test.js: 1 bestehende Zeilen geändert oder entfernt"]);
  });
}

test("SG-21 Testschutz: Datei, die keine JS/TS-Quelle ist, bleibt geschützt", () => {
  const zeile = 'import x from "./a.js"';
  assert.deepEqual(einzeln("test/sicherheit/werkzeugtexte.json", zeile, 'import x from "./a.ts"'), [
    "test/sicherheit/werkzeugtexte.json: 1 bestehende Zeilen geändert oder entfernt",
  ]);
  assert.equal(einzeln("test/notiz.md", zeile, 'import x from "./a.ts"').length, 1);
});

test("SG-21 Testschutz: Block mit anderer Anzahl oder verschobene Zeile bleibt ein Befund", () => {
  const datei = "test/a.test.js";
  const zwei = befunde({ [datei]: 'import x from "./a.js";\nimport y from "./b.js";\n' }, { [datei]: 'import x from "./a.ts";\n' });
  assert.deepEqual(zwei, [`${datei}: 2 bestehende Zeilen geändert oder entfernt`]);
  const verschoben = befunde(
    { [datei]: 'import x from "./a.js";\nconst k = 1;\n' },
    { [datei]: 'const k = 1;\nimport x from "./a.ts";\n' },
  );
  assert.equal(verschoben.length, 1);
  const mehr = befunde({ [datei]: 'import x from "./a.js";\n' }, { [datei]: 'import x from "./a.ts";\nimport z from "./z.ts";\n' });
  assert.equal(mehr.length, 1);
});

test("SG-21 Testschutz: gelöschte, ersetzte und neue Testdateien", () => {
  const alt = { "test/a.test.js": 'import x from "./a.js";\n' };
  assert.deepEqual(befunde(alt, { "test/b.test.ts": 'import x from "./a.ts";\n' }, ["test/a.test.js"]), [
    "test/a.test.js: bestehende Testdatei gelöscht",
  ]);
  assert.deepEqual(befunde(alt, { "test/neu.test.ts": 'import x from "./a.ts";\n' }), []);
});

const MIT_SUFFIX = [
  ['const m = await import("../../src/utils/x.js?vorgabe");', 'const m = await import("../../src/utils/x.ts?vorgabe");'],
  ['const m = await import("../../src/utils/x.js#teil");', 'const m = await import("../../src/utils/x.ts#teil");'],
  ["import x from '../a.js?v=1&w=2';", "import x from '../a.ts?v=1&w=2';"],
];

for (const [alt, neu] of MIT_SUFFIX) {
  test(`SG-21 Testschutz: Importendung .js zu .ts mit Query- oder Fragment-Suffix ist kein Befund (${alt})`, () => {
    assert.deepEqual(einzeln("test/a.test.js", alt, neu), []);
  });
}

const MIT_SUFFIX_UND_MEHR = [
  ['import("./x.js?vorgabe");', 'import("./x.ts?anders");'],
  ['import("./x.js?vorgabe");', 'import("./x.ts");'],
  ['import("./x.js");', 'import("./x.ts?neu");'],
  ['import("./x.js#a");', 'import("./x.ts#b");'],
  ['import("./x.js?vorgabe");', 'import("./y.ts?vorgabe");'],
];

for (const [alt, neu] of MIT_SUFFIX_UND_MEHR) {
  test(`SG-21 Testschutz: Suffix- oder Pfadänderung neben der Endung bleibt ein Befund (${alt} zu ${neu})`, () => {
    assert.deepEqual(einzeln("test/a.test.js", alt, neu), ["test/a.test.js: 1 bestehende Zeilen geändert oder entfernt"]);
  });
}
