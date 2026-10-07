import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { ESLint, Linter } from "eslint";

import hermes from "../../tools/eslint-rules/index.js";
import { REPO_ROOT } from "./probe-repo.js";

const RULE = "hermes/wort-nur-in";

const repoKonfiguration = new ESLint({ cwd: REPO_ROOT });

async function zeilenMitTreffer(filePath, zeilen) {
  const quelltext = zeilen.join("\n");
  const [{ messages }] = await repoKonfiguration.lintText(quelltext, { filePath });
  const eigene = messages.filter((meldung) => meldung.ruleId === RULE);
  return eigene.map((meldung) => `${meldung.line} ${meldung.message.split(":")[0]}`);
}

function schluesselTreffer(art, zeilen) {
  const eintrag = { name: "zugangsdaten", nurIn: [], meldung: "Zugangsdaten" };
  const optionen = art === undefined ? eintrag : { ...eintrag, art };
  const config = {
    plugins: { hermes },
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: { [RULE]: ["error", optionen] },
  };
  return new Linter({ cwd: REPO_ROOT })
    .verify(zeilen.join("\n"), config, { filename: join(REPO_ROOT, "scripts/probe.mjs") })
    .map(({ line }) => zeilen[line - 1]);
}

const SCHLUESSEL_ZEILEN = [
  "export const a = { credentials: 1 };",
  'export const b = { "credentials": 1 };',
  "export const c = (x) => x.credentials;",
  "export const d = (x) => x.credentials();",
  "export const e = (x) => ({ [x.credentials]: 1 });",
  'export const f = "credentials";',
];

test("wort-nur-in mit art aufruf: nur der Aufruf von originateCall außerhalb der Anruf-Route ist rot", async () => {
  const zeilen = [
    "export const a = (deps) => deps.originateCall({});",
    "export const b = (originateCall) => originateCall({});",
    "export const c = (deps) => deps?.originateElevenLabsCall?.({});",
    "export const d = (deps) => deps.originateCall;",
    "export const e = { originateCall: true };",
    'export const f = "originateCall";',
  ];
  assert.deepEqual(await zeilenMitTreffer("src/telephony/call-finish.js", zeilen), [
    "1 anruf-starten",
    "2 anruf-starten",
    "3 anruf-starten",
  ]);
  assert.deepEqual(await zeilenMitTreffer("src/routes/api-calls.js", zeilen), []);
});

test("wort-nur-in mit art aufruf: Sprachkosten außerhalb der Buchung zu buchen ist rot", async () => {
  const zeilen = ["export const buchen = (store) => store.addVoiceUsageCostCents('t', 5);"];
  assert.deepEqual(await zeilenMitTreffer("src/billing/cost-truing.js", zeilen), ["1 sprachkosten-buchen"]);
  assert.deepEqual(await zeilenMitTreffer("src/billing/metering.js", zeilen), []);
});

test("wort-nur-in mit art schluessel: nur ein Objektschlüssel zählt", () => {
  assert.deepEqual(schluesselTreffer("schluessel", SCHLUESSEL_ZEILEN), [
    "export const a = { credentials: 1 };",
    'export const b = { "credentials": 1 };',
  ]);
});

test("wort-nur-in ohne art: jeder Name, jede Zeichenkette und jeder Schlüssel zählt wie bisher", () => {
  assert.deepEqual(schluesselTreffer(undefined, SCHLUESSEL_ZEILEN), SCHLUESSEL_ZEILEN);
});

test("wort-nur-in: eine unbekannte art lehnt die Konfiguration ab", () => {
  assert.throws(() => schluesselTreffer("irgendwas", SCHLUESSEL_ZEILEN), /hermes\/wort-nur-in/);
});
