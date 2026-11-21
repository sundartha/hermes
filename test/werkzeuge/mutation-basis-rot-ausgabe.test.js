import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { basisRotZeilen } from "../../tools/pruefen.mjs";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");
const TESTLAUF = [
  "const datei = process.argv[3];",
  "const mutant = process.env.__STRYKER_ACTIVE_MUTANT__;",
  'if (datei === "test/laut.test.js") {',
  '  for (let zeile = 1; zeile <= 60; zeile += 1) console.log(`Zeile ${zeile}`);',
  '  console.error("Fehler am Ende");',
  "  process.exitCode = 1;",
  '} else if (datei === "test/lang.test.js") {',
  '  console.log("x".repeat(5000));',
  '  console.log("Ende");',
  "  process.exitCode = 1;",
  '} else if (datei === "test/gruen.test.js") {',
  '  console.log("gruene Ausgabe");',
  "  process.exitCode = mutant ? 1 : 0;",
  "}",
  "",
].join("\n");

function lauf(tests) {
  const ordner = mkdtempSync(join(tmpdir(), "basis-rot-"));
  try {
    mkdirSync(join(ordner, "test"));
    writeFileSync(join(ordner, "test/testbaenke-run.mjs"), TESTLAUF);
    const plan = { frist: Date.now() + 15_000, testdateiFrist: 5000, tests, dateien: [], eingebettete: {}, abdeckung: {}, protokoll: join(ordner, "protokoll.jsonl"), basisRot: join(ordner, "basis-rot.json") };
    writeFileSync(join(ordner, "plan.json"), JSON.stringify(plan));
    spawnSync(process.execPath, [PRUEFEN, "mutant"], { cwd: ordner, timeout: 20_000, killSignal: "SIGKILL", env: { ...process.env, TEIL: "0", TEILE: "1", __STRYKER_ACTIVE_MUTANT__: "1", MUTATION_PLAN: join(ordner, "plan.json") } });
    return JSON.parse(readFileSync(plan.protokoll, "utf8").trim().split("\n")[0]);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("Ist eine Testdatei zweimal ohne Mutant rot, nennt die Basis-rot-Ausgabe nach der bisherigen Zeile die letzten 40 Zeilen ihrer Ausgabe eingerückt", () => {
  const ergebnis = lauf(["test/laut.test.js"]);
  const zeilen = basisRotZeilen({ schluessel: "src/quelle.mjs:6/2", ...ergebnis });
  assert.equal(zeilen[0], "Basis rot: test/laut.test.js war bei src/quelle.mjs:6/2 zweimal ohne Mutant rot und ist für den Rest des Jobs ausgeschlossen");
  const ausgabe = zeilen.slice(1).join("\n").split("\n");
  assert.equal(ausgabe.length, 40);
  assert.equal(ausgabe[0], "  Zeile 22");
  assert.equal(ausgabe[38], "  Zeile 60");
  assert.equal(ausgabe[39], "  Fehler am Ende");
});

test("Die Ausgabe eines roten Kontrolllaufs ist auf 4000 Zeichen gekürzt und behält das Ende", () => {
  const zeilen = basisRotZeilen({ schluessel: "a:1/1", ...lauf(["test/lang.test.js"]) });
  const text = zeilen.slice(1).join("\n");
  assert.equal(text.length, 4000);
  assert.equal(text.endsWith("\n  Ende"), true);
});

test("Ist die Testdatei ohne Mutant grün, steht keine Ausgabe der Testdatei im Ergebnis", () => {
  const ergebnis = lauf(["test/gruen.test.js"]);
  assert.equal(ergebnis.ergebnis, "getötet");
  assert.equal(Object.hasOwn(ergebnis, "basisRotAusgabe"), false);
  assert.deepEqual(basisRotZeilen({ schluessel: "a:1/1", ...ergebnis }), []);
});
