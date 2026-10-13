import assert from "node:assert/strict";
import { test } from "node:test";

import { BASIS, EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const UNTERDRUECKUNGEN = "eslint-suppressions.json";
const KUERZENDER_LINT = `import { writeFileSync } from "node:fs";
if (process.argv.includes("--prune-suppressions")) writeFileSync(${JSON.stringify(UNTERDRUECKUNGEN)}, "{}\\n");
`;
const MIT_UNTERDRUECKUNGEN = {
  "lint.mjs": KUERZENDER_LINT,
  [UNTERDRUECKUNGEN]: '{"src/text.js":{"no-unused-vars":{"count":1}}}\n',
  "package.json": BASIS["package.json"].replace('"node -e 0","test:betroffen"', '"node lint.mjs","test:betroffen"'),
};

function geaenderteDateien(repo, basis) {
  const { stdout } = runIn(repo, "git", ["diff", "--name-only", basis, "HEAD"]);
  return stdout.split("\n").filter(Boolean);
}

test("ändert der Bau-Agent keine Datei, endet ein Umbau rot ohne Commit, auch wenn der Lauf die Unterdrückungen kürzt", (context) => {
  const { repo, lauf, beleg, basis, kopf } = starte(context, { auftrag: UMBAU, drehbuch: { bau: {} }, dateien: MIT_UNTERDRUECKUNGEN });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(beleg.ergebnis, "rot");
  assert.match(JSON.stringify(beleg), /Der Bau-Agent hat keine Datei geändert/);
  assert.equal(kopf, basis);
  assert.deepEqual(geaenderteDateien(repo, basis), []);
});

test("ändert der Bau-Agent eine Datei im Bereich, endet der Umbau grün mit genau einem Commit", (context) => {
  const drehbuch = { bau: { "src/text.js": "export function gross(text) {\n  return String(text).toUpperCase();\n}\n" } };
  const { repo, lauf, beleg, basis } = starte(context, { auftrag: UMBAU, drehbuch, dateien: MIT_UNTERDRUECKUNGEN });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(beleg.ergebnis, "grün");
  assert.equal(runIn(repo, "git", ["rev-list", "--count", `${basis}..HEAD`]).stdout.trim(), "1");
  assert.deepEqual(geaenderteDateien(repo, basis).sort(), [UNTERDRUECKUNGEN, "src/text.js"]);
});
