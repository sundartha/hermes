import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer.mjs", import.meta.url));
const ZIEL = "+12722205602";

function auflegen(ereignis) {
  const env = {
    PATH: process.env.PATH,
    STAGING_URL: "https://hermes-staging-erpv.onrender.com",
    STAGING_PROBE_ZIEL: ZIEL,
    STAGING_PROBE_TOKEN: PROBE_STAGING_TEST_TOKEN,
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_FALL: JSON.stringify({ eigeneNummer: ZIEL, offene: 2 }),
    GITHUB_EVENT_NAME: ereignis,
  };
  const kind = spawn("node", ["scripts/anruf-probe/probe.mjs", "auflegen"], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  return new Promise((fertig) => kind.on("close", (code) => fertig({ code, ausgabe })));
}

for (const ereignis of ["push", "schedule"]) {
  test(`auflegen im ${ereignis}-Lauf beendet offene Anrufe auch ohne Auftraggeber und Vorname`, async () => {
    const ergebnis = await auflegen(ereignis);
    assert.equal(ergebnis.code, 0);
    assert.match(ergebnis.ausgabe, /probe_aufgelegt_2/);
    assert.ok(!ergebnis.ausgabe.includes("probe_uebersprungen"));
  });
}
