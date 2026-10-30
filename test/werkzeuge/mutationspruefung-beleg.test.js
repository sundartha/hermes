import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BELEG_DATEI } from "../../tools/auftrag/absicherungsbeleg.mjs";
import { probeRepository, REPO_ROOT, runIn } from "./probe-repo.js";

const SKRIPT = join(REPO_ROOT, "tools/mutationspruefung/beleg.mjs");
const ZEILEN = Array.from({ length: 4 }, (leer, index) => `zeile${index + 1}`);

function schreibeBeleg(context, exitDatei) {
  const repo = probeRepository(context, { "src/m.js": `${ZEILEN.join("\n")}\n` });
  const basis = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFileSync(join(repo, "src/m.js"), `${ZEILEN.slice(0, 1).join("\n")}\n`);
  const ordner = join(repo, "urteil");
  mkdirSync(ordner);
  if (exitDatei !== null) writeFileSync(join(ordner, "exit-code"), exitDatei);
  const lauf = runIn(repo, "node", [SKRIPT, basis, ordner]);
  const datei = join(ordner, BELEG_DATEI);
  return { lauf, beleg: existsSync(datei) ? JSON.parse(readFileSync(datei, "utf8")) : null };
}

test("eine Zeile mit der Exit-Zahl 0 ergibt einen grünen Beleg", (context) => {
  const { lauf, beleg } = schreibeBeleg(context, "0\n");
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.equal(beleg.urteil, 0);
});

test("eine Zeile mit der Exit-Zahl 1 ergibt einen roten Beleg", (context) => {
  const { lauf, beleg } = schreibeBeleg(context, "1\n");
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.equal(beleg.urteil, 1);
});

test("eine leere, nicht numerische, gebrochene, mehrzeilige, negative oder fehlende exit-code-Datei schreibt keinen Beleg und endet mit Fehler", (context) => {
  const faelle = [["", "leer"], ["\n", "Zeilenumbruch"], ["abc\n", "Text"], ["1.5\n", "gebrochen"], ["0\n0\n", "zweizeilig"], ["-1\n", "negativ"], [null, "fehlend"]];
  const ergebnis = faelle.map(([inhalt, fall]) => {
    const { lauf, beleg } = schreibeBeleg(context, inhalt);
    return [fall, lauf.status !== 0, beleg];
  });
  assert.deepEqual(ergebnis, faelle.map(([, fall]) => [fall, true, null]));
});
