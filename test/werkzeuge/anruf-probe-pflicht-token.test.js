import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer.mjs", import.meta.url));
const ZIEL = "+12722205602";
const GUT = {
  annahmeSekunden: 4,
  begruessung: "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Probe GmbH. Das Gespräch wird für meinen Auftraggeber zusammengefasst.",
  sprache: "de",
  auftraggeber: "Probe GmbH",
  dauerSekunden: 30,
  status: "completed",
};

function aufrufen(umgebung) {
  const env = {
    PATH: process.env.PATH,
    GITHUB_SHA: "d".repeat(40),
    STAGING_URL: "https://hermes-staging-erpv.onrender.com",
    STAGING_PROBE_ZIEL: ZIEL,
    STAGING_TEST_TOKEN: PROBE_STAGING_TEST_TOKEN,
    STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
    STAGING_PROBE_VORNAME: "Anna",
    SLACK_ALERT_URL: "http://127.0.0.1:1/x",
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_FALL: JSON.stringify({ eigeneNummer: ZIEL, stand: { erstversuche: 0, anrufe: 0 }, messungen: [GUT] }),
    ...umgebung,
  };
  const kind = spawn("node", ["scripts/anruf-probe/probe.mjs"], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  return new Promise((fertig) => kind.on("close", (code) => fertig({ code, ausgabe })));
}

test("Fehlt STAGING_TEST_TOKEN: Push-Lauf übersprungen und grün, ohne Anruf", async () => {
  const ergebnis = await aufrufen({ GITHUB_EVENT_NAME: "push", STAGING_TEST_TOKEN: "" });
  assert.equal(ergebnis.code, 0);
  assert.match(ergebnis.ausgabe, /probe_uebersprungen_staging_test_token_fehlt/);
  assert.ok(!ergebnis.ausgabe.includes("probe_ziel_unerlaubt"));
  assert.ok(!ergebnis.ausgabe.includes("ANRUF"));
});

test("Fehlt STAGING_TEST_TOKEN: Zeitplan-Lauf rot, ohne Anruf", async () => {
  const ergebnis = await aufrufen({ GITHUB_EVENT_NAME: "schedule", STAGING_TEST_TOKEN: "" });
  assert.equal(ergebnis.code, 1);
  assert.match(ergebnis.ausgabe, /probe_uebersprungen_staging_test_token_fehlt/);
  assert.ok(!ergebnis.ausgabe.includes("ANRUF"));
});

test("STAGING_TEST_TOKEN ist gesetzt: Wert wird maskiert, Probe läuft", async () => {
  const ergebnis = await aufrufen({});
  assert.equal(ergebnis.code, 0);
  assert.ok(ergebnis.ausgabe.includes(`::add-mask::${PROBE_STAGING_TEST_TOKEN}`));
  assert.match(ergebnis.ausgabe, /Probe grün/);
});
