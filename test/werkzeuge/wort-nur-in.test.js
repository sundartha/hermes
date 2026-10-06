import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { ESLint, Linter } from "eslint";

import hermes from "../../tools/eslint-rules/index.js";
import { REPO_ROOT } from "./probe-repo.js";

const RULE = "hermes/wort-nur-in";
const TELNYX = "telnyx-belegabruf";
const ANRUFZEIT = "kein-anrufzeit-gate";
const BELEG = "trunk-beleg-felder";

let repoEslint;

async function repoTreffer(filePath, zeilen) {
  repoEslint ??= new ESLint({ cwd: REPO_ROOT });
  const [ergebnis] = await repoEslint.lintText(`${zeilen.join("\n")}\n`, { filePath });
  return ergebnis.messages
    .filter(({ ruleId }) => ruleId === RULE)
    .map(({ line, message }) => `${line} ${message.split(":")[0]}`);
}

function eigeneTreffer(eintraege, filePath, zeilen) {
  const linter = new Linter({ cwd: REPO_ROOT });
  const config = {
    plugins: { hermes },
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: { [RULE]: ["error", ...eintraege] },
  };
  const messages = linter.verify(zeilen.join("\n"), config, {
    filename: join(REPO_ROOT, filePath),
  });
  return messages.map(({ line, message }) => `${line} ${message}`);
}

test("wort-nur-in: der Telnyx-Belegabruf ist außerhalb des Abgleichs rot", async () => {
  const zeilen = [
    "export const probe = (deps) => deps.voiceControl.fetchCostRecordPool({});",
    "export const zuordnen = (control) => control.assignCostRecords([]);",
    'export const adresse = "https://api.telnyx.com/v2/detail_records";',
    "export const holen = (base) => fetch(`${base}/v2/detail_records`);",
  ];
  assert.deepEqual(await repoTreffer("src/telephony/call-finish.js", zeilen), [
    `1 ${TELNYX}`,
    `2 ${TELNYX}`,
    `3 ${TELNYX}`,
    `4 ${TELNYX}`,
  ]);
  assert.deepEqual(await repoTreffer("src/billing/cost-truing.js", zeilen), []);
  assert.deepEqual(await repoTreffer("src/telephony/adapters/telnyx/voice.js", zeilen), []);
});

test("wort-nur-in: der Telnyx-Belegabruf im Kommentar und in einer Beschreibung bleibt grün", async () => {
  const zeilen = [
    "// fetchCostRecordPool und assignCostRecords",
    'export const beschreibung = "Telnyx, GET /v2/detail_records?filter";',
  ];
  assert.deepEqual(await repoTreffer("src/billing/metering.js", zeilen), []);
});

test("wort-nur-in: eine Ortszeit in der Gate-Kette ist rot, auch mit großem T", async () => {
  const zeilen = [
    "export const ortszeit = (store, tenantId) => store.tenantTimezone(tenantId);",
    'export const format = (zone) => new Intl.DateTimeFormat("de", { timeZone: zone });',
    "export const spalte = `tenant_time_zone`;",
  ];
  assert.deepEqual(await repoTreffer("src/telephony/outbound-gates.js", zeilen), [
    `1 ${ANRUFZEIT}`,
    `2 ${ANRUFZEIT}`,
    `3 ${ANRUFZEIT}`,
  ]);
  assert.deepEqual(await repoTreffer("src/store.js", zeilen), []);
});

test("wort-nur-in: eine Zeitzonen-Quelle als Import ist in der Gate-Kette rot", async () => {
  const zeilen = [
    'import { callTimeContext } from "../elevenlabs/time-context.js";',
    'import { hypothese } from "../elevenlabs/nanp-area-codes.js";',
    "export const kontext = [callTimeContext, hypothese];",
  ];
  for (const datei of [
    "src/telephony/call-finish.js",
    "src/routes/api-calls.js",
    "src/turn-budget.js",
  ]) {
    assert.deepEqual(await repoTreffer(datei, zeilen), [`1 ${ANRUFZEIT}`, `2 ${ANRUFZEIT}`], datei);
  }
  assert.deepEqual(await repoTreffer("src/elevenlabs/outbound.js", zeilen), []);
});

const GATE_NAHE_DATEIEN = [
  "src/telephony/outbound-gates.js",
  "src/telephony/call-finish.js",
  "src/routes/api-calls.js",
  "src/call-duration.js",
  "src/turn-budget.js",
];

async function anrufzeitEintrag(filePath) {
  repoEslint ??= new ESLint({ cwd: REPO_ROOT });
  const config = await repoEslint.calculateConfigForFile(join(REPO_ROOT, filePath));
  const [, ...eintraege] = config.rules[RULE];
  return eintraege.find(({ name }) => name === ANRUFZEIT);
}

test("wort-nur-in: keine gate-nahe Datei steht in nurIn, und timeZone ist dort rot", async () => {
  const zeilen = ['export const format = new Intl.DateTimeFormat("de", { timeZone: "UTC" });'];
  for (const datei of GATE_NAHE_DATEIEN) {
    const { nurIn, meldung } = await anrufzeitEintrag(datei);
    assert.ok(!nurIn.includes(datei), datei);
    assert.match(meldung, /Reine Anzeige außerhalb der Gate-Kette braucht einen Eintrag/);
    assert.deepEqual(await repoTreffer(datei, zeilen), [`1 ${ANRUFZEIT}`], datei);
  }
});

test("wort-nur-in: eine Zeitzone nur im Kommentar bleibt grün", async () => {
  const zeilen = [
    "// timezone und time_zone stehen hier nur im Kommentar",
    "export const dauer = 1;",
  ];
  assert.deepEqual(await repoTreffer("src/call-duration.js", zeilen), []);
});

test("wort-nur-in: die Beleg-Felder sind außerhalb von Store und Weiche rot", async () => {
  const zeilen = [
    "export const feld = (nummer) => nummer.elInboundTrunkBelegtAt;",
    'export const spalte = "el_inbound_trunk_zugang_fp";',
    "export class Probe { #elInboundTrunkZugangFp = null; }",
    "// elInboundTrunkBelegtAt nur im Kommentar",
  ];
  assert.deepEqual(await repoTreffer("src/routes/api-read.js", zeilen), [
    `1 ${BELEG}`,
    `2 ${BELEG}`,
    `3 ${BELEG}`,
  ]);
  for (const datei of [
    "src/store/pg.js",
    "src/store/state-ops.js",
    "src/elevenlabs/inbound-path-decision.js",
  ]) {
    assert.deepEqual(await repoTreffer(datei, zeilen), [], datei);
  }
});

test("wort-nur-in: die Regel gilt nur für src/", async () => {
  const zeilen = ["export const feld = (nummer) => nummer.elInboundTrunkBelegtAt;"];
  assert.deepEqual(await repoTreffer("test/probe-beleg.test.js", zeilen), []);
  assert.deepEqual(await repoTreffer("tools/probe-beleg.mjs", zeilen), []);
});

test("wort-nur-in: ein Eintrag wählt ein festes Muster und legt nur Dateien und Meldung fest", () => {
  const eintraege = [
    { name: "trunk-beleg-felder", nurIn: ["src/a.js"], meldung: "nur in a" },
    { name: "kein-anrufzeit-gate", nurIn: [], meldung: "nirgends" },
  ];
  const zeilen = [
    "export const lesen = (objekt) => objekt.elInboundTrunkBelegtAt;",
    "export const muster = /zone/;",
    "export const zahl = 1;",
    "export const wort = `TimeZone`;",
  ];
  assert.deepEqual(eigeneTreffer(eintraege, "src/b.js", zeilen), [
    "1 trunk-beleg-felder: nur in a",
    "4 kein-anrufzeit-gate: nirgends",
  ]);
  assert.deepEqual(eigeneTreffer(eintraege, "src/a.js", zeilen), ["4 kein-anrufzeit-gate: nirgends"]);
});

test("wort-nur-in: ein unbekannter Name wird abgelehnt", () => {
  const eintraege = [{ name: "frei-erfunden", nurIn: [], meldung: "egal" }];
  assert.throws(() => eigeneTreffer(eintraege, "src/b.js", ["export const zahl = 1;"]));
});
