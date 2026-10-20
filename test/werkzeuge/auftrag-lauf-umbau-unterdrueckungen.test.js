import assert from "node:assert/strict";
import { test } from "node:test";

import { BASIS, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const UNTERDRUECKUNGEN = "eslint-suppressions.json";
const FREMD = { "src/fremd.js": { complexity: { count: 2 } } };
const EIGEN = { "src/text.js": { "no-unused-vars": { count: 1 } } };
const KUERZENDER_LINT = `import { writeFileSync } from "node:fs";
if (process.argv.includes("--prune-suppressions")) writeFileSync(${JSON.stringify(UNTERDRUECKUNGEN)}, "{}");
`;
const MIT_FREMDEN_UNTERDRUECKUNGEN = {
  "lint.mjs": KUERZENDER_LINT,
  [UNTERDRUECKUNGEN]: JSON.stringify({ ...FREMD, ...EIGEN }, null, 2),
  "package.json": BASIS["package.json"].replace('"node -e 0","test:betroffen"', '"node lint.mjs","test:betroffen"'),
};
const GROSS = "export function gross(text) {\n  return String(text).toUpperCase();\n}\n";

test("auftrag-lauf-umbau-unterdrueckungen: das Kürzen streicht veraltete Einträge der eigenen Dateien und lässt fremde Zeichen für Zeichen stehen", (context) => {
  const { repo, lauf } = starte(context, { auftrag: UMBAU, drehbuch: { bau: { "src/text.js": GROSS } }, dateien: MIT_FREMDEN_UNTERDRUECKUNGEN });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(runIn(repo, "git", ["show", `HEAD:${UNTERDRUECKUNGEN}`]).stdout, JSON.stringify(FREMD, null, 2));
});
