import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const EXIT_ROT = 1;
const UEBERLEBT = /^Verstoß: Mutant überlebt: (.+)$/gm;

function quelle(...zeilen) {
  return ["export function einordnen(zahl) {", ...zeilen, '  return "positiv";', "}", ""].join("\n");
}

function testdatei(...faelle) {
  const pruefungen = faelle.map(([zahl, wert]) => `  assert.equal(einordnen(${zahl}), "${wert}");`);
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { einordnen } from "../src/zahl.js";',
    'import "paket-aus-node-modules";',
    'test("einordnen", () => {',
    ...pruefungen,
    "});",
    "",
  ].join("\n");
}

const NEGATIV = '  if (zahl < 0) return "negativ";';
const NULL = '  if (zahl === 0) return "null";';
const BASIS = {
  "package.json": '{ "type": "module" }\n',
  ".gitignore": "node_modules/\n",
  "node_modules/paket-aus-node-modules/package.json": '{ "name": "paket-aus-node-modules", "type": "module", "main": "index.js" }\n',
  "node_modules/paket-aus-node-modules/index.js": "export {};\n",
  "src/zahl.js": quelle(NEGATIV),
  "test/zahl.test.js": testdatei([-1, "negativ"], [1, "positiv"]),
};

function pruefe(repo, ...argumente) {
  return runIn(repo, process.execPath, [WERKZEUG, ...argumente]);
}

test("eine neue Zeile ohne Test wird rot, bis ein Test sie verlangt oder der Mutant gleichwertig gemeldet ist", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  const ueberlebende = [...rot.stdout.matchAll(UEBERLEBT)].map(([, schluessel]) => schluessel);
  assert.ok(ueberlebende.length > 0 && ueberlebende.every((schluessel) => schluessel.startsWith("src/zahl.js:3:")));
  const gemeldet = pruefe(repo, "--basis", "HEAD", ...ueberlebende.flatMap((schluessel) => ["--gleichwertig", schluessel]));
  assert.equal(gemeldet.status, 0, gemeldet.stdout + gemeldet.stderr);
  writeFiles(repo, { "test/zahl.test.js": testdatei([-1, "negativ"], [0, "null"], [1, "positiv"]) });
  const gruen = pruefe(repo, "--basis", "HEAD");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
  assert.match(gruen.stdout, /^grün: \d+ Mutanten in den neuen Zeilen/m);
});

test("ein Umbau, der ungetestetes Verhalten entfernt, wird auf dem alten Stand verworfen", (context) => {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": quelle(NEGATIV, NULL) });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV) });
  const auftrag = pruefe(repo, "--basis", "HEAD", "--alter-stand");
  assert.equal(auftrag.status, EXIT_ROT, auftrag.stdout + auftrag.stderr);
  assert.match(auftrag.stdout, /^rot: Umbau verworfen, \d+ von \d+ Mutanten überleben auf dem alten Stand/m);
  assert.match(auftrag.stdout, /^Verstoß: Mutant überlebt: src\/zahl\.js:3:/m);
  commitAll(repo, "Räume auf\n\nWarum: kürzer.\n\nArt: umbau\nPaket: 27");
  const ci = pruefe(repo, "--basis", "HEAD~1");
  assert.equal(ci.status, EXIT_ROT, ci.stdout + ci.stderr);
  assert.match(ci.stdout, /^rot: Umbau verworfen/m);
  const worktrees = runIn(repo, "git", ["worktree", "list"]).stdout;
  assert.equal(worktrees.trim().split("\n").length, 1);
});
