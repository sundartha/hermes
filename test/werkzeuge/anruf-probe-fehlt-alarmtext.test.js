import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const ZIEL = "+12722205602";
const COMMIT = "d".repeat(40);
const VARIABLEN = ["STAGING_PROBE_ZIEL", "STAGING_PROBE_TOKEN", "STAGING_PROBE_AUFTRAGGEBER", "STAGING_PROBE_VORNAME"];

function stubStarten(empfangen) {
  const dienst = createServer((anfrage, rueckgabe) => {
    const teile = [];
    anfrage.on("data", (stueck) => teile.push(stueck));
    anfrage.on("end", () => {
      if (anfrage.method === "GET") {
        rueckgabe.writeHead(200, { "content-type": "application/json" });
        return rueckgabe.end("[]");
      }
      empfangen.push(JSON.parse(Buffer.concat(teile).toString()));
      rueckgabe.writeHead(201, { "content-type": "application/json" });
      rueckgabe.end(JSON.stringify({ number: 7 }));
    });
  });
  return new Promise((fertig) => dienst.listen(0, "127.0.0.1", () => fertig(dienst)));
}

function ausfuehren(argumente, umgebung) {
  const kind = spawn("node", argumente, { env: { PATH: process.env.PATH, ...umgebung } });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  return new Promise((fertig) => kind.on("close", (code) => fertig({ code, ausgabe })));
}

async function mitStubs(zusatz, lauf) {
  const slackEmpfangen = [];
  const githubEmpfangen = [];
  const slack = await stubStarten(slackEmpfangen);
  const github = await stubStarten(githubEmpfangen);
  try {
    const umgebung = {
      GITHUB_SHA: COMMIT,
      GITHUB_EVENT_NAME: "schedule",
      STAGING_URL: "https://hermes-staging-erpv.onrender.com",
      STAGING_PROBE_ZIEL: ZIEL,
      STAGING_PROBE_TOKEN: PROBE_STAGING_TEST_TOKEN,
      STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
      STAGING_PROBE_VORNAME: "Anna",
      SLACK_ALERT_URL: `http://127.0.0.1:${slack.address().port}/s`,
      GITHUB_TOKEN: "t",
      GITHUB_REPOSITORY: "sundartha/hermes",
      GITHUB_RUN_ID: "88",
      GITHUB_API_URL: `http://127.0.0.1:${github.address().port}`,
      ...zusatz,
    };
    const ergebnis = await lauf(umgebung);
    return { ...ergebnis, slackEmpfangen, githubEmpfangen };
  } finally {
    slack.close();
    github.close();
  }
}

for (const name of VARIABLEN) {
  test(`Fehlt ${name}: Slack und Issue nennen den Grund, nicht eine rote Wiederholung`, async () => {
    const grund = `probe_uebersprungen_${name.toLowerCase()}_fehlt`;
    const ergebnis = await mitStubs({ [name]: "" }, (umgebung) =>
      ausfuehren(["scripts/anruf-probe/probe.mjs"], umgebung),
    );
    assert.equal(ergebnis.code, 1);
    assert.equal(ergebnis.slackEmpfangen.length, 1);
    const text = ergebnis.slackEmpfangen[0].text;
    assert.ok(text.includes(grund));
    assert.ok(!text.includes("auch die Wiederholung"));
    assert.equal(ergebnis.githubEmpfangen.length, 1);
    const issueText = ergebnis.githubEmpfangen[0].body;
    assert.ok(issueText.includes(`Die Anrufprobe gegen Staging ist nicht gelaufen: ${grund} (Commit ${COMMIT}).`));
    assert.ok(!issueText.includes("auch die Wiederholung"));
  });
}

test("Fehlt der Alarmweg bis auf Better Stack: der Grund steht im Slack-freien Lauf weiter im Protokoll", async () => {
  const ergebnis = await mitStubs({ SLACK_ALERT_URL: "" }, (umgebung) =>
    ausfuehren(["scripts/anruf-probe/probe.mjs"], umgebung),
  );
  assert.equal(ergebnis.code, 1);
  assert.match(ergebnis.ausgabe, /probe_uebersprungen_better_stack_alert_url_fehlt/);
  assert.equal(ergebnis.slackEmpfangen.length, 0);
});

test("Rote Probe: Text bleibt rot, auch die Wiederholung, ohne Grund", async () => {
  const ergebnis = await mitStubs({}, (umgebung) =>
    ausfuehren(
      ["tools/deploy-weg.mjs", "hoertest", "--anlass", "probe", "--commit", COMMIT, "--teile", "", "--seit", "2026-01-01T00:00:00Z"],
      umgebung,
    ),
  );
  assert.equal(ergebnis.code, 0);
  const issueText = ergebnis.githubEmpfangen[0].body;
  const slackText = ergebnis.slackEmpfangen[0].text;
  assert.ok(issueText.startsWith(`Die Anrufprobe gegen Staging ist rot, auch die Wiederholung (Commit ${COMMIT}).`));
  assert.ok(!slackText.includes("probe_uebersprungen"));
});

for (const grund of ["freitext", "probe_uebersprungen__fehlt", "probe_uebersprungen_X_fehlt", "probe_uebersprungen_a_fehlt\nmehr"]) {
  test(`--grund ${JSON.stringify(grund)} wird als Aufruffehler abgewiesen`, async () => {
    const ergebnis = await mitStubs({}, (umgebung) =>
      ausfuehren(
        ["tools/deploy-weg.mjs", "hoertest", "--anlass", "probe", "--grund", grund, "--commit", COMMIT, "--teile", "probe"],
        umgebung,
      ),
    );
    assert.notEqual(ergebnis.code, 0);
    assert.match(ergebnis.ausgabe, /Aufruf:/);
    assert.equal(ergebnis.slackEmpfangen.length, 0);
    assert.equal(ergebnis.githubEmpfangen.length, 0);
  });
}
