import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
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
const EREIGNISSE = ["push", "workflow_dispatch", "schedule", undefined];
const VARIABLEN = ["STAGING_PROBE_ZIEL", "STAGING_PROBE_TOKEN", "STAGING_PROBE_AUFTRAGGEBER", "STAGING_PROBE_VORNAME"];

function aufrufen(umgebung) {
  const env = {
    PATH: process.env.PATH,
    GITHUB_SHA: "d".repeat(40),
    STAGING_URL: "https://hermes-staging-erpv.onrender.com",
    STAGING_PROBE_ZIEL: ZIEL,
    STAGING_PROBE_TOKEN: PROBE_STAGING_TEST_TOKEN,
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

for (const ereignis of EREIGNISSE) {
  for (const name of VARIABLEN) {
    test(`Ereignis ${ereignis}: ohne ${name} rot, ohne Anruf`, async () => {
      const ergebnis = await aufrufen({ GITHUB_EVENT_NAME: ereignis, [name]: "" });
      assert.equal(ergebnis.code, 1);
      assert.match(ergebnis.ausgabe, new RegExp(`probe_uebersprungen_${name.toLowerCase()}_fehlt`));
      assert.ok(!ergebnis.ausgabe.includes("Probe grün"));
      assert.ok(!ergebnis.ausgabe.includes("ANRUF"));
    });
  }

  test(`Ereignis ${ereignis}: ohne Alarmweg rot`, async () => {
    const ergebnis = await aufrufen({ GITHUB_EVENT_NAME: ereignis, SLACK_ALERT_URL: "" });
    assert.equal(ergebnis.code, 1);
    assert.match(ergebnis.ausgabe, /probe_uebersprungen_better_stack_alert_url_fehlt/);
  });
}

test("auflegen ohne STAGING_PROBE_ZIEL bleibt grün übersprungen", async () => {
  const kind = spawn("node", ["scripts/anruf-probe/probe.mjs", "auflegen"], {
    env: { PATH: process.env.PATH, GITHUB_EVENT_NAME: "push" },
  });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  const code = await new Promise((fertig) => kind.on("close", fertig));
  assert.equal(code, 0);
  assert.match(ausgabe, /probe_uebersprungen_staging_probe_ziel_fehlt/);
});

function stubStarten(empfangen) {
  const dienst = createServer((anfrage, rueckgabe) => {
    const teile = [];
    anfrage.on("data", (stueck) => teile.push(stueck));
    anfrage.on("end", () => {
      const roh = Buffer.concat(teile).toString();
      if (anfrage.method === "GET") {
        rueckgabe.writeHead(200, { "content-type": "application/json" });
        return rueckgabe.end("[]");
      }
      empfangen.push(JSON.parse(roh));
      rueckgabe.writeHead(201, { "content-type": "application/json" });
      rueckgabe.end(JSON.stringify({ number: 7 }));
    });
  });
  return new Promise((fertig) => dienst.listen(0, "127.0.0.1", () => fertig(dienst)));
}

for (const name of VARIABLEN) {
  test(`Fehlt ${name}: der Alarm geht an Slack, Lauf rot`, async () => {
    const slackEmpfangen = [];
    const githubEmpfangen = [];
    const slack = await stubStarten(slackEmpfangen);
    const github = await stubStarten(githubEmpfangen);
    try {
      const ergebnis = await aufrufen({
        GITHUB_EVENT_NAME: "schedule",
        [name]: "",
        SLACK_ALERT_URL: `http://127.0.0.1:${slack.address().port}/s`,
        GITHUB_TOKEN: "t",
        GITHUB_REPOSITORY: "sundartha/hermes",
        GITHUB_RUN_ID: "88",
        GITHUB_API_URL: `http://127.0.0.1:${github.address().port}`,
      });
      assert.equal(ergebnis.code, 1);
      assert.equal(slackEmpfangen.length, 1);
      assert.match(slackEmpfangen[0].text, /Staging-Anrufprobe rot/);
      assert.equal(githubEmpfangen.length, 1);
    } finally {
      slack.close();
      github.close();
    }
  });
}
