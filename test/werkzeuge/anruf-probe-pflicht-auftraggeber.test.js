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

for (const name of ["STAGING_PROBE_AUFTRAGGEBER", "STAGING_PROBE_VORNAME"]) {
  const meldung = `probe_uebersprungen_${name.toLowerCase()}_fehlt`;

  test(`Fehlt ${name}: Push-Lauf übersprungen und rot, ohne Anruf`, async () => {
    const ergebnis = await aufrufen({ GITHUB_EVENT_NAME: "push", [name]: "" });
    assert.equal(ergebnis.code, 1);
    assert.ok(ergebnis.ausgabe.includes(meldung));
    assert.ok(!ergebnis.ausgabe.includes("ANRUF"));
    assert.ok(!ergebnis.ausgabe.includes("offenlegung"));
  });

  test(`Fehlt ${name}: Zeitplan-Lauf rot mit gleicher Meldung, ohne Anruf`, async () => {
    const ergebnis = await aufrufen({ GITHUB_EVENT_NAME: "schedule", [name]: "" });
    assert.equal(ergebnis.code, 1);
    assert.ok(ergebnis.ausgabe.includes(meldung));
    assert.ok(!ergebnis.ausgabe.includes("ANRUF"));
  });
}
