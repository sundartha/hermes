import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer.mjs", import.meta.url));
const ZIEL = "+12722205602";

function auflegen(umgebung) {
  const env = {
    PATH: process.env.PATH,
    STAGING_URL: "https://hermes-staging-erpv.onrender.com",
    STAGING_PROBE_ZIEL: ZIEL,
    STAGING_PROBE_TOKEN: PROBE_STAGING_TEST_TOKEN,
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_FALL: JSON.stringify({ eigeneNummer: ZIEL, offene: 3 }),
    ...umgebung,
  };
  const kind = spawn("node", ["scripts/anruf-probe/probe.mjs", "auflegen"], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  return new Promise((fertig) => kind.on("close", (code) => fertig({ code, ausgabe })));
}

test("auflegen ohne STAGING_PROBE_TOKEN im Push-Lauf: übersprungen, grün, nichts beendet", async () => {
  const ergebnis = await auflegen({ GITHUB_EVENT_NAME: "push", STAGING_PROBE_TOKEN: "" });
  assert.equal(ergebnis.code, 0);
  assert.match(ergebnis.ausgabe, /probe_uebersprungen_staging_probe_token_fehlt/);
  assert.ok(!ergebnis.ausgabe.includes("probe_ziel_unerlaubt"));
  assert.ok(!ergebnis.ausgabe.includes("AUFGELEGT"));
});

test("auflegen ohne STAGING_PROBE_TOKEN im Zeitplan-Lauf: rot mit gleicher Meldung", async () => {
  const ergebnis = await auflegen({ GITHUB_EVENT_NAME: "schedule", STAGING_PROBE_TOKEN: "" });
  assert.equal(ergebnis.code, 1);
  assert.match(ergebnis.ausgabe, /probe_uebersprungen_staging_probe_token_fehlt/);
  assert.ok(!ergebnis.ausgabe.includes("AUFGELEGT"));
});

test("auflegen ohne STAGING_PROBE_ZIEL: übersprungen wie bisher", async () => {
  const ergebnis = await auflegen({ GITHUB_EVENT_NAME: "push", STAGING_PROBE_ZIEL: "" });
  assert.equal(ergebnis.code, 0);
  assert.match(ergebnis.ausgabe, /probe_uebersprungen_staging_probe_ziel_fehlt/);
  assert.ok(!ergebnis.ausgabe.includes("AUFGELEGT"));
});

test("auflegen mit beiden Werten beendet offene Anrufe", async () => {
  const ergebnis = await auflegen({ GITHUB_EVENT_NAME: "push" });
  assert.equal(ergebnis.code, 0);
  assert.match(ergebnis.ausgabe, /AUFGELEGT/);
  assert.match(ergebnis.ausgabe, /probe_aufgelegt_3/);
});
