import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const EINSTIEG = join(REPO, "tools/neu/neu.mjs");
const EXIT_OK = 0;
const EXIT_VORHANDEN = 1;
const EXIT_AUFRUF = 2;
const KARTEN = ["tools/bausteine.json", "tools/bereiche.json"];
const wurzeln = [];

function frischeWurzel() {
  const wurzel = mkdtempSync(join(tmpdir(), "neu-test-art-"));
  wurzeln.push(wurzel);
  mkdirSync(join(wurzel, "tools"), { recursive: true });
  for (const karte of KARTEN) cpSync(join(REPO, karte), join(wurzel, karte));
  mkdirSync(join(wurzel, "test/anrufe"), { recursive: true });
  return wurzel;
}

function neu(wurzel, ...argumente) {
  return spawnSync(process.execPath, [EINSTIEG, "--wurzel", wurzel, ...argumente], {
    encoding: "utf8",
  });
}

after(() => {
  for (const wurzel of wurzeln) rmSync(wurzel, { recursive: true, force: true });
});

test("neu test legt test/<bereich>/<name>.test.js an und nennt die Datei", () => {
  const wurzel = frischeWurzel();
  const lauf = neu(wurzel, "test", "anrufe", "rueckruf-zusage");
  assert.equal(lauf.status, EXIT_OK, "npm run neu legt keinen Test an: " + lauf.stderr);
  const datei = join(wurzel, "test/anrufe/rueckruf-zusage.test.js");
  assert.ok(existsSync(datei), "npm run neu legt keinen Test an");
  assert.match(readFileSync(datei, "utf8"), /^import test from "node:test";/);
  assert.match(lauf.stdout, /test\/anrufe\/rueckruf-zusage\.test\.js/);
});

test("neu test überschreibt keine vorhandene Datei", () => {
  const wurzel = frischeWurzel();
  const datei = join(wurzel, "test/anrufe/vorhanden.test.js");
  writeFileSync(datei, "meine Arbeit\n");
  const lauf = neu(wurzel, "test", "anrufe", "vorhanden");
  assert.equal(lauf.status, EXIT_VORHANDEN);
  assert.match(lauf.stderr, /vorhanden\.test\.js/);
  assert.equal(readFileSync(datei, "utf8"), "meine Arbeit\n");
});

test("neu test lehnt ungültige Namen und unbekannte Bereiche ab, ohne etwas anzulegen", () => {
  const wurzel = frischeWurzel();
  const faelle = [
    ["anrufe", "../ausbruch"],
    ["anrufe", "Gross"],
    ["anrufe", "a b"],
    ["gibt-es-nicht", "name"],
    ["werkzeuge", "name"],
  ];
  for (const [bereich, name] of faelle) {
    const lauf = neu(wurzel, "test", bereich, name);
    assert.equal(lauf.status, EXIT_AUFRUF, `${bereich} ${name}: ${lauf.stderr}`);
  }
  assert.equal(neu(wurzel, "unbekannt", "anrufe", "name").status, EXIT_AUFRUF);
  assert.equal(neu(wurzel, "test", "anrufe").status, EXIT_AUFRUF);
  assert.equal(existsSync(join(wurzel, "ausbruch.test.js")), false);
  assert.equal(existsSync(join(wurzel, "test/anrufe/name.test.js")), false);
});
