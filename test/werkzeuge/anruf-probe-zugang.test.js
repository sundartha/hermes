import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN, PROBE_ZUGANG_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";

const WORKFLOW = readFileSync(new URL("../../.github/workflows/staging.yml", import.meta.url), "utf8");
const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer.mjs", import.meta.url));
const BASIS = "https://hermes-staging-erpv.onrender.com";
const ZIEL = "+12722205602";
const urspruenglich = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = urspruenglich;
});

function schritt(name) {
  const treffer = WORKFLOW.match(new RegExp(`^      - name: ${name}[^\\n]*\\n([\\s\\S]*?)(?=^      - name:|^  [a-z]+:\\n|(?![\\s\\S]))`, "m"));
  assert.ok(treffer, `Schritt ${name} fehlt`);
  return treffer[1];
}

function probeStarten(umgebung) {
  const env = {
    PATH: process.env.PATH,
    GITHUB_SHA: "d".repeat(40),
    STAGING_URL: BASIS,
    STAGING_PROBE_ZIEL: ZIEL,
    STAGING_PROBE_TOKEN: PROBE_ZUGANG_SCHLUESSEL,
    STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
    STAGING_PROBE_VORNAME: "Anna",
    SLACK_ALERT_URL: "http://127.0.0.1:1/x",
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_FALL: JSON.stringify({ eigeneNummer: ZIEL, offene: 0 }),
    ...umgebung,
  };
  const kind = spawn("node", ["scripts/anruf-probe/probe.mjs", "auflegen"], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  return new Promise((fertig) => kind.on("close", (code) => fertig({ code, ausgabe })));
}

test("Anrufer ruft die enge Probe-Schnittstelle mit dem Probe-Wert auf, nicht /mcp", async () => {
  const aufrufe = [];
  globalThis.fetch = async (url, optionen) => {
    aufrufe.push({ url, optionen });
    const rpc = { jsonrpc: "2.0", id: 1, result: { structuredContent: { number: ZIEL } } };
    return { ok: true, status: 200, text: async () => JSON.stringify(rpc) };
  };
  Object.assign(process.env, {
    STAGING_URL: BASIS,
    STAGING_PROBE_TOKEN: PROBE_ZUGANG_SCHLUESSEL,
    STAGING_TEST_TOKEN: PROBE_STAGING_TEST_TOKEN,
    STAGING_PROBE_ZIEL: ZIEL,
  });
  const modul = await import("../../scripts/anruf-probe/anrufer.mjs");
  assert.equal(await modul.anrufer.eigeneNummer(), ZIEL);
  assert.equal(aufrufe[0].url, `${BASIS}/intern/probe/mcp`);
  const { headers } = aufrufe[0].optionen;
  assert.equal(headers.authorization, `Bearer ${PROBE_ZUGANG_SCHLUESSEL}`);
});

test("Ohne STAGING_PROBE_TOKEN im Push-Lauf: Aufräumen übersprungen mit dem neuen Namen", async () => {
  const ergebnis = await probeStarten({ GITHUB_EVENT_NAME: "push", STAGING_PROBE_TOKEN: "", STAGING_TEST_TOKEN: PROBE_STAGING_TEST_TOKEN });
  assert.equal(ergebnis.code, 0);
  assert.match(ergebnis.ausgabe, /probe_uebersprungen_staging_probe_token_fehlt/);
  assert.ok(!ergebnis.ausgabe.includes("AUFGELEGT"));
});

test("Ohne STAGING_PROBE_TOKEN im Zeitplan-Lauf: rot, auch wenn STAGING_TEST_TOKEN gesetzt ist", async () => {
  const ergebnis = await probeStarten({ GITHUB_EVENT_NAME: "schedule", STAGING_PROBE_TOKEN: "", STAGING_TEST_TOKEN: PROBE_STAGING_TEST_TOKEN });
  assert.equal(ergebnis.code, 1);
  assert.match(ergebnis.ausgabe, /probe_uebersprungen_staging_probe_token_fehlt/);
});

test("Workflow: beide Probe-Schritte reichen STAGING_PROBE_TOKEN durch und nicht den Wert des Lastlaufs", () => {
  for (const name of ["Anrufprobe", "Offene Probe-Anrufe beenden"]) {
    const text = schritt(name);
    assert.ok(text.includes("STAGING_PROBE_TOKEN: ${{ secrets.STAGING_PROBE_TOKEN }}"), name);
    assert.ok(!text.includes("STAGING_TEST_TOKEN"), name);
  }
});

test("Workflow: der Lastlauf behält STAGING_TEST_TOKEN", () => {
  assert.ok(schritt("Lastlauf").includes("STAGING_TEST_TOKEN: ${{ secrets.STAGING_TEST_TOKEN }}"));
});
