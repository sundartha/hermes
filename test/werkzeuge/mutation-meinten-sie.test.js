import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { mutationUrteil } from "../../tools/pruefen.mjs";

const PR_TEXT = "## Überlebende Mutanten\n\n- `src/a.js:10/1` wird getötet von `test/x.test.js`\n";

const mutant = (schluessel, ergebnis, test) => ({ schluessel, mutation: "StringLiteral: \"\"", ergebnis, ...(test === undefined ? {} : { test }) });

function urteil(mutanten) {
  const zusammenfassung = join(mkdtempSync(join(tmpdir(), "mutation-meinten-")), "zusammenfassung.md");
  const vorher = { PR_TEXT: process.env.PR_TEXT, GITHUB_STEP_SUMMARY: process.env.GITHUB_STEP_SUMMARY, ROTPROBE_GRUEN: process.env.ROTPROBE_GRUEN };
  Object.assign(process.env, { PR_TEXT, GITHUB_STEP_SUMMARY: zusammenfassung });
  delete process.env.ROTPROBE_GRUEN;
  const log = console.log;
  console.log = () => {};
  try {
    const gruen = mutationUrteil(mutanten, 1);
    return { gruen, zeilen: readFileSync(zusammenfassung, "utf8").split("\n").filter((zeile) => zeile.startsWith("Rot:")) };
  } finally {
    console.log = log;
    for (const [name, wert] of Object.entries(vorher)) wert === undefined ? delete process.env[name] : (process.env[name] = wert);
  }
}

const ROT = "Rot: `test/x.test.js` ist auf master grün; der PR-Text nennt `src/a.js:10/1`, die Mutation tötet ihn aber nicht mit genau diesem Test";

test("Falscher Schlüssel: die Meldung nennt den gültigen Schlüssel der Datei mit dem tötenden Test", () => {
  const { gruen, zeilen } = urteil([mutant("src/a.js:94/1", "getötet", "test/x.test.js")]);
  assert.equal(gruen, false);
  assert.equal(zeilen.length, 1);
  assert.equal(zeilen[0], `${ROT}. Meinten Sie \`src/a.js:94/1\` (getötet von \`test/x.test.js\`)?`);
});

test("Mehrere getötete Mutanten derselben Datei werden alle genannt, andere Dateien und nicht getötete nicht", () => {
  const { gruen, zeilen } = urteil([
    mutant("src/a.js:94/1", "getötet", "test/x.test.js"),
    mutant("src/a.js:95/2", "getötet", "test/y.test.js"),
    mutant("src/b.js:5/3", "getötet", "test/z.test.js"),
    mutant("src/a.js:96/4", "überlebt"),
  ]);
  assert.equal(gruen, false);
  assert.equal(zeilen[0], `${ROT}. Meinten Sie \`src/a.js:94/1\` (getötet von \`test/x.test.js\`), \`src/a.js:95/2\` (getötet von \`test/y.test.js\`)?`);
});

test("Ohne getöteten Mutanten in der Quelldatei bleibt die Meldung ohne Vorschlag", () => {
  const { gruen, zeilen } = urteil([mutant("src/b.js:5/3", "getötet", "test/z.test.js"), mutant("src/a.js:96/4", "überlebt")]);
  assert.equal(gruen, false);
  assert.equal(zeilen[0], `${ROT}.`);
});
