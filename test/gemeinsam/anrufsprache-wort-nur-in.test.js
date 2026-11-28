import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const eslint = new ESLint({ cwd: WURZEL });

async function meldungen(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter((meldung) => meldung.ruleId === "hermes/wort-nur-in" && meldung.message.startsWith("anrufsprache:"));
}

const VERSTOESSE = [
  'import { localeFor } from "./i18n/locales.ts";\n',
  "export const a = (call) => localeFor(call.language);\n",
  "export const sprachtexteFuer = localeFor;\n",
  "const x = localeFor;\nexport { x };\n",
];

for (const quelltext of VERSTOESSE) {
  test(`anrufsprache: außerhalb der Liste rot (${quelltext.trim().replaceAll("\n", " ")})`, async () => {
    const gefunden = await meldungen("src/probe-sprache.js", quelltext);
    assert.ok(gefunden.length >= 1);
    assert.match(gefunden[0].message, /^anrufsprache: .*anrufstart\.ts/);
  });

  test(`anrufsprache: in anrufstart.ts und unter src/i18n grün (${quelltext.trim().replaceAll("\n", " ")})`, async () => {
    assert.deepEqual(await meldungen("src/anrufe/start/anrufstart.ts", quelltext), []);
    assert.deepEqual(await meldungen("src/i18n/texte-paket.ts", quelltext), []);
  });
}

const MANDANTENSPRACHE = [
  "src/mcp-no-tenant.js",
  "src/mcp/anruf-ergebnis.js",
  "src/mcp/kontext.js",
  "src/self-service-routes.js",
  "src/store/greeting-notice-migration.js",
  "src/telephony/outbound-gates.js",
];

for (const datei of MANDANTENSPRACHE) {
  test(`anrufsprache: ${datei} liest die Mandantensprache und bleibt in der Liste grün`, async () => {
    assert.deepEqual(await meldungen(datei, VERSTOESSE[1]), []);
  });
}

test("anrufsprache: src hat keinen Leser der Anrufsprache außerhalb von textePaketFuer und anrufstart.ts", async () => {
  const ergebnisse = await eslint.lintFiles(["src/claude.js", "src/elevenlabs/*.{js,ts}", "src/routes/*.{js,ts}", "src/telephony/*.js", "src/consult/*.js", "src/research/*.js", "src/mcp/*.js"]);
  const treffer = ergebnisse.flatMap((ergebnis) => ergebnis.messages.filter((m) => m.ruleId === "hermes/wort-nur-in" && m.message.startsWith("anrufsprache:")).map((m) => `${ergebnis.filePath}:${m.line}`));
  assert.deepEqual(treffer, []);
});

test("anrufsprache: ein Alias auf localeFor unter anderem Namen bleibt rot", async () => {
  const gefunden = await meldungen("src/probe-alias.js", "const sprachwahlFuer = localeFor;\nexport { sprachwahlFuer };\n");
  assert.equal(gefunden.length, 1);
});
