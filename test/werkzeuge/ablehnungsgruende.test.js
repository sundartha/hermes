import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { ESLint, Linter } from "eslint";

import hermes from "../../tools/eslint-rules/index.js";
import { REPO_ROOT, probeDirectory } from "./probe-repo.js";

const RULE = "hermes/ablehnungsgruende";
const GATES = "src/telephony/outbound-gates.js";
const ZITIERTER_GRUND = /„([^“]+)“/;

let repoEslint;

async function befunde(zeilen) {
  repoEslint ??= new ESLint({ cwd: REPO_ROOT });
  const [ergebnis] = await repoEslint.lintText(`${zeilen.join("\n")}\n`, { filePath: GATES });
  return ergebnis.messages
    .filter(({ ruleId }) => ruleId === RULE)
    .map(({ messageId, message, line }) => ({
      messageId,
      zeile: zeilen[line - 1],
      grund: ZITIERTER_GRUND.exec(message)?.[1],
    }));
}

async function alleTabellenGruende() {
  const leer = await befunde(["export const nichts = 0;"]);
  return leer.map(({ grund }) => grund);
}

function vergabeZeilen(gruende) {
  return gruende.map((grund, index) => `export const g${index} = { grund: ${JSON.stringify(grund)} };`);
}

test("ablehnungsgruende: die echte Gate-Datei vergibt nur Gründe mit Tabelleneintrag und lässt keinen Eintrag tot", async () => {
  repoEslint ??= new ESLint({ cwd: REPO_ROOT });
  const [ergebnis] = await repoEslint.lintFiles([GATES]);
  assert.deepEqual(ergebnis.messages.filter(({ ruleId }) => ruleId === RULE), []);
});

test("ablehnungsgruende: ein Grund ohne Tabelleneintrag ist rot, als Feld und als Audit-Argument", async () => {
  const gruende = await alleTabellenGruende();
  const feld = 'export const neu = { status: 403, grund: "erfundener_grund" };';
  const audit = 'export const audit = (ctx) => denialAudit("noch_ein_grund", ctx);';
  assert.deepEqual(await befunde([...vergabeZeilen(gruende), feld, audit]), [
    { messageId: "unbekannt", zeile: feld, grund: "erfundener_grund" },
    { messageId: "unbekannt", zeile: audit, grund: "noch_ein_grund" },
  ]);
});

test("ablehnungsgruende: ein Tabelleneintrag, den die Gate-Datei nie vergibt, ist als tot rot", async () => {
  const [ungenutzt, ...vergeben] = await alleTabellenGruende();
  assert.ok(vergeben.length > 0, "die Tabelle muss mehr als einen Grund haben");
  const zeilen = vergabeZeilen(vergeben);
  assert.deepEqual(await befunde(zeilen), [{ messageId: "tot", zeile: zeilen[0], grund: ungenutzt }]);
});

test("ablehnungsgruende: als Audit-Argument gelten nur benannte Gründe", async () => {
  const gruende = await alleTabellenGruende();
  const freierText = "export const d = (ctx, text) => denialAudit(text, ctx);";
  const vorlage = "export const e = (ctx, fehler) => denialAudit(`${fehler.code}`, ctx);";
  const zeilen = [
    ...vergabeZeilen(gruende),
    "export const a = (ctx, grund) => denialAudit(grund, ctx);",
    "export const b = (ctx, fehler) => denialAudit(fehler.grund, ctx);",
    "export const c = (ctx) => denialAudit(GATE_ERROR_GRUND, ctx);",
    freierText,
    vorlage,
  ];
  assert.deepEqual(await befunde(zeilen), [
    { messageId: "unbenannt", zeile: freierText, grund: undefined },
    { messageId: "unbenannt", zeile: vorlage, grund: undefined },
  ]);
});

test("ablehnungsgruende: fehlt die Tabelle, meldet die Regel das, statt still nichts zu prüfen", (context) => {
  const directory = probeDirectory(context, {});
  const config = {
    plugins: { hermes },
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: { [RULE]: ["error", { datei: "fehlt.mjs", tabelle: "TEXTE", sprache: "en" }] },
  };
  const messages = new Linter({ cwd: directory }).verify('export const a = { grund: "x" };', config, {
    filename: join(directory, GATES),
  });
  assert.deepEqual(
    messages.map(({ messageId }) => messageId),
    ["tabelleFehlt"],
  );
});
