import assert from "node:assert/strict";
import { test } from "node:test";

import { BASIS, EXIT_ROT, pruefe, schluessel, UEBERLEBT } from "./mutationspruefung-hilfen.js";
import { commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const TOT = "export function tot(zahl) {\n  return zahl > 0;\n}\n";
const UEBERSPRUNGEN =
  /^src\/tot\.js: übersprungen: gelöscht, auf der Basis von keinem Modul importiert\.$/m;
const OHNE_TEST = "src/tot.js:1 keine Testdatei erreicht die Datei";
const UMBAU = "Lösche tot\n\nWarum: Probe.\n\nArt: umbau\nPaket: 27";

function geloescht(context, weitere = {}) {
  const repo = probeRepository(context, { ...BASIS, "src/tot.js": TOT, ...weitere });
  runIn(repo, "git", ["rm", "-q", "src/tot.js"]);
  return repo;
}

function bleibtRot(lauf) {
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual(schluessel(lauf.stdout, UEBERLEBT), [OHNE_TEST]);
  assert.doesNotMatch(lauf.stdout, UEBERSPRUNGEN);
}

test("eine gelöschte Datei, die auf der Basis kein Modul importiert, ist kein Ziel von „alter Stand“ und steht als übersprungen in der Ausgabe", (context) => {
  const befunde = {
    "tools/basis/knip.json": '["files|src/tot.js|src/tot.js"]\n',
    "docs/tot.md": "`src/tot.js` ist ungenutzt.\n",
  };
  const repo = geloescht(context, befunde);
  const auftrag = pruefe(repo, "--basis", "HEAD", "--alter-stand");
  assert.equal(auftrag.status, 0, auftrag.stdout + auftrag.stderr);
  assert.match(auftrag.stdout, UEBERSPRUNGEN);
  assert.deepEqual(schluessel(auftrag.stdout, UEBERLEBT), []);
  commitAll(repo, UMBAU);
  const ci = pruefe(repo, "--basis", "HEAD~1");
  assert.equal(ci.status, 0, ci.stdout + ci.stderr);
  assert.match(ci.stdout, UEBERSPRUNGEN);
});

test("eine gelöschte Datei, die auf der Basis ein Modul importiert, ein Skript in package.json oder ein Workflow startet, bleibt auf dem alten Stand rot", (context) => {
  const importeure = [
    { "src/andere.js": 'export { tot } from "./tot.js";\n' },
    { "tools/werkzeug.mjs": 'import { tot } from "../src/tot.js";\nconsole.log(tot(1));\n' },
    { "package.json": '{ "type": "module", "scripts": { "tot": "node src/tot" } }\n' },
    { ".github/workflows/tot.yml": "jobs:\n  tot:\n    steps:\n      - run: node src/tot.js\n" },
  ];
  for (const importeur of importeure) {
    const repo = geloescht(context, importeur);
    bleibtRot(pruefe(repo, "--basis", "HEAD", "--alter-stand"));
    commitAll(repo, UMBAU);
    bleibtRot(pruefe(repo, "--basis", "HEAD~1"));
  }
});

test("eine gelöschte index.js, deren Verzeichnis package.json als Einstieg nennt, bleibt auf dem alten Stand rot", (context) => {
  const repo = probeRepository(context, {
    ...BASIS,
    "package.json": '{ "type": "module", "main": "src/tot" }\n',
    "src/tot/index.js": TOT,
  });
  runIn(repo, "git", ["rm", "-q", "src/tot/index.js"]);
  const auftrag = pruefe(repo, "--basis", "HEAD", "--alter-stand");
  assert.equal(auftrag.status, EXIT_ROT, auftrag.stdout + auftrag.stderr);
  assert.deepEqual(schluessel(auftrag.stdout, UEBERLEBT), [
    "src/tot/index.js:1 keine Testdatei erreicht die Datei",
  ]);
  assert.doesNotMatch(auftrag.stdout, /übersprungen: gelöscht/);
});

test("eine geänderte, nicht gelöschte Datei ohne Test und ohne Importeur bleibt auf dem alten Stand rot", (context) => {
  const repo = probeRepository(context, { ...BASIS, "src/tot.js": TOT });
  writeFiles(repo, { "src/tot.js": "export function tot(zahl) {\n  return zahl >= 0;\n}\n" });
  const auftrag = pruefe(repo, "--basis", "HEAD", "--alter-stand");
  assert.equal(auftrag.status, EXIT_ROT, auftrag.stdout + auftrag.stderr);
  assert.deepEqual(schluessel(auftrag.stdout, UEBERLEBT), [
    "src/tot.js:2 keine Testdatei erreicht die Datei",
  ]);
  assert.doesNotMatch(auftrag.stdout, /übersprungen: gelöscht/);
});
