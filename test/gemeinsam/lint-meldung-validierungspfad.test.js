import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const eslint = new ESLint({ cwd: WURZEL });

async function meldungen(datei, quelltext, regel) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter((meldung) => meldung.ruleId === regel).map((meldung) => meldung.message);
}

function erwarteOrtOhneEndung(texte) {
  assert.equal(texte.length, 1, "genau eine Meldung erwartet");
  assert.match(texte[0], /src\/routes\/_validation(?!\.js)/);
  assert.doesNotMatch(texte[0], /_validation\.js/);
}

test("Lint-Meldung Eingaberegel: nennt src/routes/_validation ohne .js", async () => {
  erwarteOrtOhneEndung(
    await meldungen(
      "src/probe-eingabe.js",
      'export const a = (req) => typeof req.body.email === "string";\n',
      "hermes/eingabe-nur-mit-schema",
    ),
  );
});

test("Lint-Meldung Router-Form: nennt src/routes/_validation ohne .js", async () => {
  erwarteOrtOhneEndung(
    await meldungen(
      "src/routes/probe-route.js",
      "export function probeHandler(req, res) {\n  res.end();\n}\n",
      "no-restricted-syntax",
    ),
  );
});
