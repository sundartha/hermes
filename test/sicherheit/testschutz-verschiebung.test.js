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
  const ordner = mkdtempSync(join(tmpdir(), "testschutz-verschiebung-"));
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

const ALT = 'import assert from "node:assert/strict";\nimport { a } from "../src/a.js";\nimport h from "./gemeinsam/h.js";\nconst m = await import("./gemeinsam/m.js");\nassert.equal(a(), 1);\n';
const NEU = 'import assert from "node:assert/strict";\nimport { a } from "../../src/a.js";\nimport h from "../gemeinsam/h.js";\nconst m = await import("../gemeinsam/m.js");\nassert.equal(a(), 1);\n';

function verschiebe(neuerPfad, neuerInhalt, [alterPfad, alterInhalt] = ["test/x.test.js", ALT]) {
  return befunde({ [alterPfad]: alterInhalt }, { [neuerPfad]: neuerInhalt }, [alterPfad]);
}

test("SG-21 Testschutz: Verschiebung in einen Bereichsordner mit einem ../ mehr ist kein Befund", () => {
  assert.deepEqual(verschiebe("test/sicherheit/x.test.js", NEU), []);
});

test("SG-21 Testschutz: Verschiebung ohne Importe und mit Einfachanführungszeichen ist kein Befund", () => {
  assert.deepEqual(verschiebe("test/a/x.test.js", "const z = 1;\n", ["test/x.test.js", "const z = 1;\n"]), []);
  assert.deepEqual(verschiebe("test/a/x.test.js", "import h from '../h.js';\nimport 'node:fs';\nrequire('../k.js');\n", ["test/x.test.js", "import h from './h.js';\nimport 'node:fs';\nrequire('./k.js');\n"]), []);
});

test("SG-21 Testschutz: Verschiebung mit geändertem Testinhalt bleibt ein Befund", () => {
  const befund = ["test/x.test.js: bestehende Testdatei gelöscht"];
  assert.deepEqual(verschiebe("test/sicherheit/x.test.js", NEU.replace("a(), 1", "a(), 2")), befund);
  assert.deepEqual(verschiebe("test/sicherheit/x.test.js", `${NEU}assert.ok(true);\n`), befund);
});

test("SG-21 Testschutz: Verschiebung mit gelöschter Assertion bleibt ein Befund", () => {
  assert.deepEqual(verschiebe("test/sicherheit/x.test.js", NEU.replace("assert.equal(a(), 1);\n", "")), ["test/x.test.js: bestehende Testdatei gelöscht"]);
});

test("SG-21 Testschutz: Verschiebung mit falschem Importpfad bleibt ein Befund", () => {
  assert.equal(verschiebe("test/sicherheit/x.test.js", ALT).length, 1);
  assert.equal(verschiebe("test/sicherheit/x.test.js", NEU.replace("../../src/a.js", "../src/a.js")).length, 1);
});

test("SG-21 Testschutz: Verschiebung an anderen Ort oder unter anderem Namen bleibt ein Befund", () => {
  const befund = ["test/x.test.js: bestehende Testdatei gelöscht"];
  assert.deepEqual(verschiebe("test/sicherheit/y.test.js", NEU), befund);
  assert.deepEqual(verschiebe("test/a/b/x.test.js", NEU), befund);
  assert.deepEqual(verschiebe("tools/x.test.js", NEU), befund);
  assert.deepEqual(verschiebe("tools/a/x.test.js", NEU), befund);
  assert.deepEqual(verschiebe("x.test.js", NEU), befund);
});

test("SG-21 Testschutz: Verschiebung aus einem Bereichsordner in einen anderen bleibt ein Befund", () => {
  assert.deepEqual(verschiebe("test/b/x.test.js", NEU, ["test/a/x.test.js", ALT]), ["test/a/x.test.js: bestehende Testdatei gelöscht"]);
});

test("SG-21 Testschutz: Löschung ohne Gegenstück bleibt ein Befund", () => {
  assert.deepEqual(befunde({ "test/x.test.js": ALT }, { "test/y.test.js": "x\n" }, ["test/x.test.js"]), ["test/x.test.js: bestehende Testdatei gelöscht"]);
});

test("SG-21 Testschutz: ein Ziel deckt nur eine Löschung", () => {
  const vorher = { "test/x.test.js": ALT, "test/y.test.js": ALT };
  const nachher = { "test/a/x.test.js": NEU };
  assert.deepEqual(befunde(vorher, nachher, ["test/x.test.js", "test/y.test.js"]), ["test/y.test.js: bestehende Testdatei gelöscht"]);
});

test("SG-21 Testschutz: bestehende Zieldatei zählt nicht als Verschiebung", () => {
  const vorher = { "test/x.test.js": ALT, "test/a/x.test.js": "leer\n" };
  assert.deepEqual(befunde(vorher, { "test/a/x.test.js": NEU }, ["test/x.test.js"]), [
    "test/a/x.test.js: 1 bestehende Zeilen geändert oder entfernt",
    "test/x.test.js: bestehende Testdatei gelöscht",
  ]);
});

test("SG-21 Testschutz: Verschiebung einer Nicht-Quelldatei braucht gleichen Inhalt", () => {
  const zeile = 'import x from "./a.js"\n';
  assert.deepEqual(verschiebe("test/a/n.md", zeile, ["test/n.md", zeile]), []);
  assert.deepEqual(verschiebe("test/a/n.md", 'import x from "../a.js"\n', ["test/n.md", zeile]), ["test/n.md: bestehende Testdatei gelöscht"]);
});

test("SG-21 Testschutz: Importmuster in String-Literalen wird nicht umgeschrieben", () => {
  const skript = "const s = 'await import(\"./src/store.js\")';\nconst t = `from \"./b.js\"`;\n// import \"./c.js\"\n";
  const befund = ["test/x.test.js: bestehende Testdatei gelöscht"];
  assert.deepEqual(verschiebe("test/sicherheit/x.test.js", skript, ["test/x.test.js", skript]), []);
  assert.deepEqual(verschiebe("test/sicherheit/x.test.js", skript.replace("./src/", "../src/"), ["test/x.test.js", skript]), befund);
  assert.deepEqual(verschiebe("test/sicherheit/x.test.js", skript.replace("./b.js", "../b.js"), ["test/x.test.js", skript]), befund);
  assert.deepEqual(verschiebe("test/sicherheit/x.test.js", skript.replace("./c.js", "../c.js"), ["test/x.test.js", skript]), befund);
});

test("SG-21 Testschutz: Import nach einem String-Literal wird weiter umgeschrieben", () => {
  const alt = "const s = 'x';\nimport h from './h.js';\nconst k = \"it's\"; const m = await import('./m.js');\n";
  const neu = "const s = 'x';\nimport h from '../h.js';\nconst k = \"it's\"; const m = await import('../m.js');\n";
  assert.deepEqual(verschiebe("test/sicherheit/x.test.js", neu, ["test/x.test.js", alt]), []);
});

const BEFUND_X = ["test/x.test.js: bestehende Testdatei gelöscht"];

test("SG-21 Testschutz: Verschiebung mit new URL und import.meta.url plus neuer Nachbar-Hilfsdatei bleibt ein Befund", () => {
  const inhalt = 'const h = await import(new URL("./h.js", import.meta.url));\n';
  const gefunden = befunde({ "test/x.test.js": inhalt, "test/h.js": "throw new Error('x');\n" }, { "test/a/x.test.js": inhalt, "test/a/h.js": "export {};\n" }, ["test/x.test.js", "test/h.js"]);
  assert.ok(gefunden.includes(BEFUND_X[0]));
});

test("SG-21 Testschutz: Verschiebung mit __dirname bleibt ein Befund", () => {
  assert.deepEqual(verschiebe("test/a/x.test.js", "const o = __dirname;\n", ["test/x.test.js", "const o = __dirname;\n"]), BEFUND_X);
});

test("SG-21 Testschutz: Verschiebung mit dirname(fileURLToPath(import.meta.url)) bleibt ein Befund", () => {
  const inhalt = "const o = dirname(fileURLToPath(import.meta.url));\n";
  assert.deepEqual(verschiebe("test/a/x.test.js", inhalt, ["test/x.test.js", inhalt]), BEFUND_X);
});

test("SG-21 Testschutz: Verschiebung mit import.meta.dirname bleibt ein Befund", () => {
  const inhalt = "const o = import.meta.dirname;\n";
  assert.deepEqual(verschiebe("test/a/x.test.js", inhalt, ["test/x.test.js", inhalt]), BEFUND_X);
});

test("SG-21 Testschutz: Verschiebung mit import aus Template-Literal bleibt ein Befund", () => {
  const inhalt = "const m = await import(`./gemeinsam/${name}.js`);\n";
  assert.deepEqual(verschiebe("test/a/x.test.js", inhalt, ["test/x.test.js", inhalt]), BEFUND_X);
  const aufwaerts = "const m = await import(`../src/${name}.js`);\n";
  assert.deepEqual(verschiebe("test/a/x.test.js", aufwaerts, ["test/x.test.js", aufwaerts]), BEFUND_X);
});

test("SG-21 Testschutz: Verschiebung mit __filename in einem Template-Ausdruck bleibt ein Befund", () => {
  const inhalt = "const o = `${__filename}`;\n";
  assert.deepEqual(verschiebe("test/a/x.test.js", inhalt, ["test/x.test.js", inhalt]), BEFUND_X);
});

test("SG-21 Testschutz: Verschiebung mit import.meta.url nur in String, Kommentar oder Template-Text bleibt kein Befund", () => {
  const inhalt = 'const s = "import.meta.url __dirname";\n// __filename import.meta.dirname\n/* __dirname */\nconst t = `__dirname import.meta.url`;\n';
  assert.deepEqual(verschiebe("test/a/x.test.js", inhalt, ["test/x.test.js", inhalt]), []);
});
