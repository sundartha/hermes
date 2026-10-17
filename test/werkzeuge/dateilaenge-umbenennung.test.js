import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { FILE_LENGTH_TOOL, outputLines, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const KONSTANTEN = 500;
const ERSTE = "export function erste(wert) {\n  return wert;\n}\n";
const LANG = ERSTE + Array.from({ length: KONSTANTEN }, (_leer, index) => `export const wert${index} = ${index};\n`).join("");
const TYPISIERT = LANG.replace("erste(wert)", "erste(wert: number): number");
const KOPF = "| Datei | Zeilen vorher | Zeilen nachher |";
const ZEILEN_VORHER = LANG.split("\n").length - 1;
const LAUFZEITZEILE = "export const neu = 1;\n";
const TYPZEILE = "export type Zahl = number;\n";

function bericht(repo) {
  const lauf = runIn(repo, process.execPath, [FILE_LENGTH_TOOL, "--basis", "HEAD"]);
  assert.equal(lauf.status, 0, lauf.stderr);
  return outputLines(lauf.stdout);
}

test("eine lange Datei, die .js→.ts nur Typen bekommt, behält ihren Vorher-Stand; mit einer Laufzeitzeile mehr gilt sie als neu", (context) => {
  const repo = probeRepository(context, { "src/lang.js": LANG });
  rmSync(join(repo, "src/lang.js"));
  writeFiles(repo, { "src/lang.ts": TYPISIERT });
  const gleich = bericht(repo);
  assert.ok(!gleich.includes(KOPF), gleich.join("\n"));
  writeFiles(repo, { "src/lang.ts": `${TYPISIERT}${LAUFZEITZEILE}` });
  const geaendert = bericht(repo);
  assert.ok(geaendert.includes(`| \`src/lang.ts\` | neu | ${ZEILEN_VORHER + 1} |`), geaendert.join("\n"));
});

test("eine lange Datei, die .js→.ts nur Typen bekommt und dabei wächst, nennt die Zeilenzahl des alten Pfads als Vorher-Stand", (context) => {
  const repo = probeRepository(context, { "src/lang.js": LANG });
  rmSync(join(repo, "src/lang.js"));
  writeFiles(repo, { "src/lang.ts": `${TYPISIERT}${TYPZEILE}` });
  const gewachsen = bericht(repo);
  assert.ok(
    gewachsen.includes(`| \`src/lang.ts\` | ${ZEILEN_VORHER} | ${ZEILEN_VORHER + 1} |`),
    gewachsen.join("\n"),
  );
});
