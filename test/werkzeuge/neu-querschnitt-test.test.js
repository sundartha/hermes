import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

const WURZEL = resolve(import.meta.dirname, "../..");
const NEU = join(WURZEL, "tools/neu.mjs");
const ordner = [];

after(() => {
  for (const eintrag of ordner) rmSync(eintrag, { recursive: true, force: true });
});

function neu(...argumente) {
  const root = mkdtempSync(join(tmpdir(), "neu-querschnitt-"));
  ordner.push(root);
  mkdirSync(join(root, "tools"));
  cpSync(join(WURZEL, "tools/bereiche.json"), join(root, "tools/bereiche.json"));
  const ergebnis = spawnSync(process.execPath, [NEU, "--wurzel", root, ...argumente], { cwd: root, encoding: "utf8" });
  return { root, ergebnis };
}

const QUERSCHNITT = ["last", "sicherheit", "betrieb", "anrufpause", "ausfallproben", "einstellungen", "mandant", "start", "utils"];

test("ein Querschnitt-Ordner wird als Ziel eines neuen Tests angenommen und bekommt eine Vorlage ohne Bereichs-Import", () => {
  const name = "querschnitt-probe-xyz";
  const belegt = QUERSCHNITT.filter((ziel) => existsSync(join(WURZEL, `test/${ziel}/${name}.test.js`)));
  assert.deepEqual(belegt, []);
  for (const ziel of QUERSCHNITT) {
    const { root, ergebnis } = neu("test", ziel, name);
    const datei = join(root, `test/${ziel}/${name}.test.js`);
    try {
      assert.equal(ergebnis.status, 0, `${ziel}: ${ergebnis.stderr}`);
      assert.match(ergebnis.stdout, new RegExp(`test/${ziel}/${name}\\.test\\.js angelegt\\.`));
      const text = readFileSync(datei, "utf8");
      assert.doesNotMatch(text, /src\//);
      assert.match(text, new RegExp(`test\\("${name}: `));
      assert.equal(existsSync(join(WURZEL, `test/${ziel}/${name}.test.js`)), false);
    } finally {
      rmSync(datei, { force: true });
    }
  }
});

test("ein Ordner, der weder Bereich noch Querschnitt ist, bricht weiter mit Unbekannter Bereich ab", () => {
  const { ergebnis } = neu("test", "gibtsnicht", "x-y");
  assert.equal(ergebnis.status, 1);
  assert.match(ergebnis.stderr, /Unbekannter Bereich gibtsnicht/);
});
