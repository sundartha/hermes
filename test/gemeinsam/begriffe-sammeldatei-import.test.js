import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const eslint = new ESLint({ cwd: WURZEL });

async function wortMeldungen(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter((meldung) => meldung.ruleId === "hermes/wort-nur-in");
}

const FAELLE = [
  ["src/probe-a.js", 'import { KYC_LEVEL } from "./store/defaults.js";\nexport const a = KYC_LEVEL;\n'],
  ["src/billing/probe-b.js", 'import { KYC_LEVEL } from "../store/defaults.ts";\nexport const b = KYC_LEVEL;\n'],
  ["src/store/probe-c.js", 'import { KYC_LEVEL } from "./defaults.js";\nexport const c = KYC_LEVEL;\n'],
  ["src/store/probe-d.js", 'export const d = await import("../store/defaults");\n'],
  ["src/store/probe-e.js", 'export { KYC_LEVEL } from "./defaults";\n'],
];

for (const [datei, quelltext] of FAELLE) {
  test(`Import über store/defaults ist rot und nennt src/begriffe: ${datei}`, async () => {
    const meldungen = await wortMeldungen(datei, quelltext);
    assert.equal(meldungen.length, 1);
    assert.match(meldungen[0].message, /src\/begriffe\/<thema>\.js/);
  });
}

test("Import aus der Begriffsdatei bleibt grün", async () => {
  const meldungen = await wortMeldungen(
    "src/billing/probe-f.js",
    'import { KYC_LEVEL } from "../begriffe/mandant.ts";\nexport const f = KYC_LEVEL;\n',
  );
  assert.deepEqual(meldungen, []);
});

test("Die Weiterleitung src/store/defaults gibt es nicht mehr", () => {
  assert.equal(existsSync(resolve(WURZEL, "src/store/defaults.ts")), false);
  assert.equal(existsSync(resolve(WURZEL, "src/store/defaults.js")), false);
});
