import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN, PROBE_TELNYX_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";

const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer.mjs", import.meta.url));
const STAGING = "https://hermes-staging-erpv.onrender.com";
const LIVE = "https://vodafone-agent.onrender.com";
const ZIEL = "+12722205602";
const LIVE_NUMMER = "+4930555000111";
const GUT = {
  annahmeSekunden: 4,
  begruessung:
    "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Probe GmbH. Das Gespräch wird für meinen Auftraggeber zusammengefasst.",
  sprache: "de",
  auftraggeber: "Probe GmbH",
  dauerSekunden: 30,
  status: "completed",
};

async function lauf({ adresse = STAGING, eigene = ZIEL, ziel = ZIEL } = {}) {
  const env = {
    PATH: process.env.PATH,
    GITHUB_SHA: "e".repeat(40),
    STAGING_URL: adresse,
    STAGING_PROBE_ZIEL: ziel,
    STAGING_PROBE_TELNYX_KEY: PROBE_TELNYX_SCHLUESSEL,
    STAGING_TEST_TOKEN: PROBE_STAGING_TEST_TOKEN,
    STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
    STAGING_PROBE_VORNAME: "Anna",
    SLACK_ALERT_URL: "http://127.0.0.1:1/x",
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_FALL: JSON.stringify({ eigeneNummer: eigene, stand: { erstversuche: 0, anrufe: 0 }, messungen: [GUT] }),
  };
  const kind = spawn("node", ["scripts/anruf-probe/probe.mjs"], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const code = await new Promise((fertig) => kind.on("close", fertig));
  const sichtbar = ausgabe.split("\n").filter((zeile) => !zeile.startsWith("::add-mask::")).join("\n");
  return { code, sichtbar, gewaehlt: sichtbar.split("\n").filter((zeile) => zeile.startsWith("ANRUF")).length };
}

const ABGELEHNT = [
  ["Staging meldet eine andere eigene Nummer", { eigene: LIVE_NUMMER }],
  ["Staging meldet keine eigene Nummer", { eigene: null }],
  ["Zielnummer ist die Live-Nummer, Staging meldet die Staging-Nummer", { ziel: LIVE_NUMMER }],
  ["Adresse ist Live", { adresse: LIVE }],
  ["Adresse mit Zugangsdaten", { adresse: "https://a:b@hermes-staging-erpv.onrender.com" }],
  ["Adresse ist eine andere Staging-Adresse", { adresse: "https://hermes-staging-xxxx.onrender.com" }],
];

for (const [name, abweichung] of ABGELEHNT) {
  test(`SG-36 Anrufprobe wählt nichts, wenn das Ziel nicht die eigene Staging-Nummer ist: ${name}`, async () => {
    const { code, sichtbar, gewaehlt } = await lauf(abweichung);
    assert.equal(code, 1);
    assert.equal(gewaehlt, 0);
    assert.match(sichtbar, /probe_ziel_unerlaubt/);
  });
}

test("Zielschloss lässt die Staging-Nummer bei Staging-Adresse durch: ein Anruf", async () => {
  const { code, gewaehlt } = await lauf();
  assert.equal(code, 0);
  assert.equal(gewaehlt, 1);
});
