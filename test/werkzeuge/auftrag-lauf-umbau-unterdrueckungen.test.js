import assert from "node:assert/strict";
import { test } from "node:test";

import { PRUEFUNG } from "../../tools/auftrag/zweck.mjs";
import { BASIS, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const UNTERDRUECKUNGEN = "eslint-suppressions.json";
const FREMD = { "src/fremd.js": { complexity: { count: 2 } } };
const EIGEN = { "src/text.js": { "no-unused-vars": { count: 1 } } };
const ESLINT_LEER = "{\n}";
const EINRUECKUNG_ANDERS_ALS_IM_LAUF = 4;

function lintSchreibt(text) {
  return `import { writeFileSync } from "node:fs";
if (process.argv.includes("--prune-suppressions")) writeFileSync(${JSON.stringify(UNTERDRUECKUNGEN)}, ${JSON.stringify(text)});
`;
}

function mitUnterdrueckungen(vorher, lintAusgabe) {
  return {
    "lint.mjs": lintSchreibt(lintAusgabe),
    [UNTERDRUECKUNGEN]: vorher,
    "package.json": BASIS["package.json"].replace('"node -e 0","test:betroffen"', '"node lint.mjs","test:betroffen"'),
  };
}

const MIT_FREMDEN_UNTERDRUECKUNGEN = mitUnterdrueckungen(JSON.stringify({ ...FREMD, ...EIGEN }, null, 2), "{}");
const ANDERS_FORMATIERT = `${JSON.stringify({ ...EIGEN, ...FREMD }, null, EINRUECKUNG_ANDERS_ALS_IM_LAUF)}\n`;
const NUR_FREMDER_GESTRICHEN = mitUnterdrueckungen(ANDERS_FORMATIERT, JSON.stringify(EIGEN));
const NUR_EIGENE = mitUnterdrueckungen(JSON.stringify(EIGEN, null, 2), ESLINT_LEER);
const GROSS = "export function gross(text) {\n  return String(text).toUpperCase();\n}\n";

test("auftrag-lauf-umbau-unterdrueckungen: das Kürzen streicht veraltete Einträge der eigenen Dateien und lässt fremde Zeichen für Zeichen stehen", (context) => {
  const { repo, lauf } = starte(context, { auftrag: UMBAU, drehbuch: { bau: { "src/text.js": GROSS } }, dateien: MIT_FREMDEN_UNTERDRUECKUNGEN });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(runIn(repo, "git", ["show", `HEAD:${UNTERDRUECKUNGEN}`]).stdout, JSON.stringify(FREMD, null, 2));
});

test("auftrag-lauf-umbau-unterdrueckungen: streicht das Kürzen nur einen fremden Eintrag, bleibt die anders formatierte Datei im Ausgangstext", (context) => {
  const { repo, lauf, beleg } = starte(context, { auftrag: UMBAU, drehbuch: { bau: { "src/text.js": GROSS } }, dateien: NUR_FREMDER_GESTRICHEN });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(beleg.pruefungen.some(({ name, exitCode }) => name === PRUEFUNG.UNTERDRUECKUNGEN_KUERZEN && exitCode === 0), JSON.stringify(beleg.pruefungen));
  assert.equal(runIn(repo, "git", ["show", `HEAD:${UNTERDRUECKUNGEN}`]).stdout, ANDERS_FORMATIERT);
});

test("auftrag-lauf-umbau-unterdrueckungen: ist nach dem Kürzen kein Eintrag mehr übrig, steht die Datei so da, wie ESLint die leere Liste schreibt", (context) => {
  const { repo, lauf } = starte(context, { auftrag: UMBAU, drehbuch: { bau: { "src/text.js": GROSS } }, dateien: NUR_EIGENE });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(runIn(repo, "git", ["show", `HEAD:${UNTERDRUECKUNGEN}`]).stdout, ESLINT_LEER);
});
