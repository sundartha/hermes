import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { ESLint, Linter } from "eslint";

import hermes from "../../tools/eslint-rules/index.js";
import { REPO_ROOT, probeDirectory } from "./probe-repo.js";

const RULE = "hermes/config-pfade";
const SKRIPT = "scripts/probe-konfig.mjs";
const SKRIPT_MIT_BLATT = "scripts/smoke-stripe-payment.mjs";

let repoEslint;

function eslint() {
  repoEslint ??= new ESLint({ cwd: REPO_ROOT });
  return repoEslint;
}

async function befunde(filePath, zeilen) {
  const [ergebnis] = await eslint().lintText(`${zeilen.join("\n")}\n`, { filePath });
  return ergebnis.messages
    .filter(({ ruleId }) => ruleId === RULE)
    .map(({ line, messageId }) => `${messageId}: ${zeilen[line - 1]}`);
}

const GUELTIG = [
  "export const a = (config) => config.server.port;",
  "export const b = (config) => config.billing.paymentEnabled;",
  "export const c = (config) => config.telnyxElevenLabs.voiceId;",
  "export const d = (config) => config.elevenLabsPlayTts.synthTimeoutMs;",
  'export const e = (config) => config["server"];',
  "export const f = (deps) => deps.config.erfunden;",
];
const NAMENSRAUM_OHNE_BLATT = "export const g = (config) => config.billing;";

test("config-pfade: gültige Pfade, die zwei Gruppen und fremde Objekte bleiben grün", async () => {
  assert.deepEqual(await befunde(SKRIPT, GUELTIG), []);
  assert.deepEqual(await befunde(SKRIPT_MIT_BLATT, GUELTIG), []);
});

test("config-pfade: ein Namensraum oder ein Blatt, das es nicht gibt, ist in jedem Skript rot", async () => {
  const zeilen = [
    "export const a = (config) => config.publicUrl;",
    "export const b = (config) => config.server.erfundenesBlatt;",
  ];
  const erwartet = [`keinNamensraum: ${zeilen[0]}`, `unbekanntesBlatt: ${zeilen[1]}`];
  assert.deepEqual(await befunde(SKRIPT, zeilen), erwartet);
  assert.deepEqual(await befunde(SKRIPT_MIT_BLATT, zeilen), erwartet);
});

test("config-pfade: ein ganzer Namensraum ist nur in den drei Skripten mit Blattpflicht rot", async () => {
  assert.deepEqual(await befunde(SKRIPT, [NAMENSRAUM_OHNE_BLATT]), []);
  for (const datei of [
    "scripts/telnyx-call-latency.mjs",
    SKRIPT_MIT_BLATT,
    "scripts/el-nummern-registrierung.mjs",
  ])
    assert.deepEqual(await befunde(datei, [NAMENSRAUM_OHNE_BLATT]), [`ohneBlatt: ${NAMENSRAUM_OHNE_BLATT}`], datei);
});

test("config-pfade: alle Skripte unter scripts/ sind heute frei", async () => {
  const ergebnisse = await eslint().lintFiles(["scripts"]);
  assert.ok(ergebnisse.length > 0);
  const betroffen = ergebnisse.filter((ergebnis) => ergebnis.messages.some((meldung) => meldung.ruleId === RULE));
  assert.deepEqual(
    betroffen.map((ergebnis) => ergebnis.filePath),
    [],
  );
});

test("config-pfade: fehlt die Namensraum-Tabelle, meldet die Regel das, statt still nichts zu prüfen", (context) => {
  const leererOrdner = probeDirectory(context, {});
  const ohneTabelle = { datei: "fehlt.mjs", tabelle: "NAMENSRAEUME", gruppen: [] };
  const linter = new Linter({ cwd: leererOrdner });
  const [meldung, ...weitere] = linter.verify(
    "export const a = (config) => config.x.y;",
    [{ plugins: { hermes }, rules: { [RULE]: ["error", ohneTabelle] } }],
    { filename: join(leererOrdner, SKRIPT) },
  );
  assert.equal(meldung?.messageId, "tabelleFehlt");
  assert.deepEqual(weitere, []);
});
