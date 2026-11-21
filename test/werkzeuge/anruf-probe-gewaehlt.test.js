import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN, PROBE_TELNYX_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";

const COMMIT = "e".repeat(40);
const ZIEL = "+4930555000199";
const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer.mjs", import.meta.url));
const WORKFLOW = readFileSync(new URL("../../.github/workflows/staging.yml", import.meta.url), "utf8");
const GUT = {
  annahmeSekunden: 4,
  begruessung:
    "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Probe GmbH. Das Gespräch wird für meinen Auftraggeber zusammengefasst.",
  sprache: "de",
  auftraggeber: "Probe GmbH",
  dauerSekunden: 30,
  status: "completed",
};
const ROT = { ...GUT, status: "failed" };

async function laufen({ fall = {}, umgebung = {}, mitOutput = true } = {}) {
  const ordner = mkdtempSync(join(tmpdir(), "probe-output-"));
  const ausgabeDatei = join(ordner, "output");
  const werte = { eigeneNummer: ZIEL, stand: { erstversuche: 0, anrufe: 0 }, messungen: [GUT], ...fall };
  const env = {
    PATH: process.env.PATH,
    GITHUB_SHA: COMMIT,
    GITHUB_API_URL: "http://127.0.0.1:1",
    GITHUB_REPOSITORY: "sundartha/hermes",
    GITHUB_TOKEN: "t",
    GITHUB_RUN_ID: "88",
    STAGING_URL: "https://hermes-staging-erpv.onrender.com",
    STAGING_PROBE_ZIEL: ZIEL,
    STAGING_TEST_TOKEN: PROBE_STAGING_TEST_TOKEN,
    STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
    STAGING_PROBE_VORNAME: "Anna",
    STAGING_PROBE_TELNYX_KEY: PROBE_TELNYX_SCHLUESSEL,
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_FALL: JSON.stringify(werte),
    BETTER_STACK_ALERT_URL: "http://127.0.0.1:1/x",
    ...(mitOutput ? { GITHUB_OUTPUT: ausgabeDatei } : {}),
    ...umgebung,
  };
  const kind = spawn("node", ["scripts/anruf-probe/probe.mjs"], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const code = await new Promise((fertig) => kind.on("close", fertig));
  const inhalt = existsSync(ausgabeDatei) ? readFileSync(ausgabeDatei, "utf8") : "";
  return { code, ausgabe, inhalt };
}

test("Tageslimit erreicht: kein gewaehlt=true, Ausgabe und Exit 0 bleiben", async () => {
  const { code, ausgabe, inhalt } = await laufen({ fall: { stand: { erstversuche: 5, anrufe: 5 } } });
  assert.equal(code, 0);
  assert.match(ausgabe, /probe_tageslimit_erreicht/);
  assert.doesNotMatch(inhalt, /gewaehlt=true/);
});

test("Grüne Probe und grüne Wiederholung: genau die Zeile gewaehlt=true", async () => {
  const gruen = await laufen();
  assert.match(gruen.ausgabe, /Probe grün/);
  assert.equal(gruen.inhalt, "gewaehlt=true\n");
  const wiederholt = await laufen({ fall: { messungen: [ROT, GUT] } });
  assert.match(wiederholt.ausgabe, /Wiederholung grün/);
  assert.equal(wiederholt.inhalt, "gewaehlt=true\n");
});

test("Rote Probe, übersprungene Probe und lokaler Lauf ohne GITHUB_OUTPUT: kein gewaehlt=true", async () => {
  const rot = await laufen({ fall: { messungen: [ROT, ROT] } });
  assert.equal(rot.code, 1);
  assert.doesNotMatch(rot.inhalt, /gewaehlt/);
  const uebersprungen = await laufen({ umgebung: { STAGING_PROBE_ZIEL: "" } });
  assert.match(uebersprungen.ausgabe, /probe_uebersprungen/);
  assert.doesNotMatch(uebersprungen.inhalt, /gewaehlt/);
  const lokal = await laufen({ mitOutput: false });
  assert.equal(lokal.code, 0);
  assert.match(lokal.ausgabe, /Probe grün/);
});

test("Workflow: Probe-Schritt hat die Kennung probe, Lebenszeichen nur bei gewaehlt == 'true'", () => {
  assert.match(WORKFLOW, /- name: Anrufprobe \(Kern in scripts\/anruf-probe\)\n {8}if: [^\n]+\n {8}id: probe\n/);
  assert.match(
    WORKFLOW,
    /- name: Lebenszeichen Anrufprobe\n {8}if: success\(\) && github\.event_name == 'schedule' && steps\.probe\.outputs\.gewaehlt == 'true'\n/,
  );
});
