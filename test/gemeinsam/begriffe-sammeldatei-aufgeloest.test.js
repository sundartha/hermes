import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const eslint = new ESLint({ cwd: WURZEL });

async function wortMeldungen(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter((meldung) => meldung.ruleId === "hermes/wort-nur-in");
}

test("Import ../defaults.ts aus src/store/zustand ist rot und nennt src/begriffe", async () => {
  const meldungen = await wortMeldungen(
    "src/store/zustand/probe.js",
    'import { X } from "../defaults.ts";\nexport const a = X;\n',
  );
  assert.equal(meldungen.length, 1);
  assert.match(meldungen[0].message, /begriffe-sammeldatei/);
  assert.match(meldungen[0].message, /src\/begriffe\/<thema>\.js/);
});

test("Gleichnamige Datei src/billing/defaults.js bleibt grün", async () => {
  const meldungen = await wortMeldungen(
    "src/billing/probe.js",
    'import { X } from "./defaults.js";\nexport const a = X;\n',
  );
  assert.deepEqual(meldungen, []);
});

test("Gleichnamige Datei src/store/zustand/defaults.js bleibt grün", async () => {
  const meldungen = await wortMeldungen(
    "src/store/zustand/probe.js",
    'import { X } from "./defaults.js";\nexport const a = X;\n',
  );
  assert.deepEqual(meldungen, []);
});
