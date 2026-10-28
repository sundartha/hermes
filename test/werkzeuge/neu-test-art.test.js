import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXIT_AUFRUF,
  EXIT_OK,
  EXIT_VORHANDEN,
  frischeWurzel,
  neu,
  raeumeWurzelnAuf,
} from "./neu-hilfen.js";

after(raeumeWurzelnAuf);

test("neu test legt test/<bereich>/<name>.test.js an und nennt die Datei", () => {
  const wurzel = frischeWurzel("neu-test-art-");
  const lauf = neu(wurzel, "test", "anrufe", "rueckruf-zusage");
  assert.equal(lauf.status, EXIT_OK, "npm run neu legt keinen Test an: " + lauf.stderr);
  const datei = join(wurzel, "test/anrufe/rueckruf-zusage.test.js");
  assert.ok(existsSync(datei), "npm run neu legt keinen Test an");
  assert.match(readFileSync(datei, "utf8"), /^import test from "node:test";/);
  assert.match(lauf.stdout, /test\/anrufe\/rueckruf-zusage\.test\.js/);
});

test("neu test überschreibt keine vorhandene Datei", () => {
  const wurzel = frischeWurzel("neu-test-art-");
  const datei = join(wurzel, "test/anrufe/vorhanden.test.js");
  mkdirSync(join(wurzel, "test/anrufe"), { recursive: true });
  writeFileSync(datei, "meine Arbeit\n");
  const lauf = neu(wurzel, "test", "anrufe", "vorhanden");
  assert.equal(lauf.status, EXIT_VORHANDEN);
  assert.match(lauf.stderr, /vorhanden\.test\.js/);
  assert.equal(readFileSync(datei, "utf8"), "meine Arbeit\n");
});

test("neu test lehnt ungültige Namen und unbekannte Bereiche ab, ohne etwas anzulegen", () => {
  const wurzel = frischeWurzel("neu-test-art-");
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
