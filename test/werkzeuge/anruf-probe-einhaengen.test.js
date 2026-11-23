import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";
import { anruferBauen } from "../../scripts/anruf-probe/anrufer.mjs";

const WORKFLOW = readFileSync(new URL("../../.github/workflows/staging.yml", import.meta.url), "utf8");
const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer.mjs", import.meta.url));
const BASIS = "https://hermes-staging-erpv.onrender.com";
const ZIEL = "+12722205602";
const COMMIT = "d".repeat(40);
const GUT = {
  annahmeSekunden: 4,
  begruessung: "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Probe GmbH. Das Gespräch wird für meinen Auftraggeber zusammengefasst.",
  sprache: "de",
  auftraggeber: "Probe GmbH",
  dauerSekunden: 30,
  status: "completed",
};

function job(name) {
  const treffer = WORKFLOW.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z]+:\\n|(?![\\s\\S]))`, "m"));
  assert.ok(treffer, `Job ${name} fehlt in staging.yml`);
  return treffer[1];
}

function schritt(text, name) {
  const treffer = text.match(new RegExp(`^      - name: ${name}[^\\n]*\\n([\\s\\S]*?)(?=^      - name:|(?![\\s\\S]))`, "m"));
  assert.ok(treffer, `Schritt ${name} fehlt`);
  return treffer[1];
}

function aufrufen({ umgebung = {}, argumente = [], fall = {} } = {}) {
  const env = {
    PATH: process.env.PATH,
    GITHUB_SHA: COMMIT,
    STAGING_URL: BASIS,
    STAGING_PROBE_ZIEL: ZIEL,
    STAGING_PROBE_TOKEN: PROBE_STAGING_TEST_TOKEN,
    STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
    STAGING_PROBE_VORNAME: "Anna",
    SLACK_ALERT_URL: "http://127.0.0.1:1/x",
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_FALL: JSON.stringify({ eigeneNummer: ZIEL, stand: { erstversuche: 0, anrufe: 0 }, messungen: [GUT], ...fall }),
    ...umgebung,
  };
  const kind = spawn("node", ["scripts/anruf-probe/probe.mjs", ...argumente], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  return new Promise((fertig) => kind.on("close", (code) => fertig({ code, ausgabe })));
}

test("Zeitplan: ein Zeitplan, die Probe läuft im Staging-Job und damit bei Push, Zeitplan und Handstart ohne Lastlauf", () => {
  const zeitplaene = [...WORKFLOW.matchAll(/^\s+- cron: "([^"]+)"/gm)].map((treffer) => treffer[1]);
  assert.deepEqual(zeitplaene, ["17 2 * * *"]);
  assert.ok(!/^ {2}probe:/m.test(WORKFLOW));
  assert.match(job("staging"), /^ {4}if: github\.event_name == 'push' \|\| github\.event_name == 'schedule' \|\| \(github\.event_name == 'workflow_dispatch' && \(!inputs\.lastlauf \|\| inputs\.alarmprobe\)\)$/m);
});

test("Probe-Schritt: läuft nach dem grünen Abwarten, bei absichtlich_rot trotzdem, und vor dem Heartbeat", () => {
  const text = job("staging");
  const probeSchritt = schritt(text, "Anrufprobe");
  assert.match(probeSchritt, /if: \$\{\{ \(success\(\) \|\| inputs\.absichtlich_rot\) && \(github\.event_name != 'workflow_dispatch' \|\| !inputs\.alarmprobe\) \}\}/);
  assert.ok(text.indexOf("- name: Anrufprobe") < text.indexOf("- name: Heartbeat Nachtlauf"));
  assert.ok(text.indexOf("- name: Heartbeat Nachtlauf") < text.indexOf("- name: Offene Probe-Anrufe beenden"));
});

test("Probe-Schritt: ruft probe.mjs mit Anrufer-Modul, Token, Ziel, absichtlich_rot und beiden Alarmwegen auf", () => {
  const probeSchritt = schritt(job("staging"), "Anrufprobe");
  assert.match(probeSchritt, /run: node scripts\/anruf-probe\/probe\.mjs\s*$/m);
  for (const name of [
    "STAGING_URL: https://hermes-staging-erpv.onrender.com",
    "PROBE_ANRUFER_MODUL: ${{ github.workspace }}/scripts/anruf-probe/anrufer.mjs",
    "ABSICHTLICH_ROT: ${{ inputs.absichtlich_rot }}",
    "STAGING_PROBE_TOKEN: ${{ secrets.STAGING_PROBE_TOKEN }}",
    "STAGING_PROBE_ZIEL: ${{ vars.STAGING_PROBE_ZIEL }}",
    "STAGING_PROBE_AUFTRAGGEBER: ${{ vars.STAGING_PROBE_AUFTRAGGEBER }}",
    "STAGING_PROBE_VORNAME: ${{ vars.STAGING_PROBE_VORNAME }}",
    "GITHUB_TOKEN: ${{ github.token }}",
    "BETTER_STACK_ALERT_URL: ${{ secrets.BETTER_STACK_ALERT_URL }}",
    "SLACK_ALERT_URL: ${{ secrets.SLACK_ALERT_URL }}",
  ]) {
    assert.ok(probeSchritt.includes(name), name);
  }
  assert.ok(!WORKFLOW.includes("STAGING_PROBE_TELNYX_KEY"));
});

test("Auflegen-Schritt: läuft auch bei Abbruch und Fehler und beendet offene Probe-Anrufe", () => {
  const auflegen = schritt(job("staging"), "Offene Probe-Anrufe beenden");
  assert.match(auflegen, /if: always\(\)/);
  assert.match(auflegen, /run: node scripts\/anruf-probe\/probe\.mjs auflegen\s*$/m);
  assert.match(auflegen, /STAGING_PROBE_TOKEN: \$\{\{ secrets\.STAGING_PROBE_TOKEN \}\}/);
  assert.match(auflegen, /PROBE_ANRUFER_MODUL: /);
});

test("Anrufer: offene Probe-Anrufe an das Ziel werden abgebrochen, fremde und beendete nicht", async () => {
  const abgebrochen = [];
  const calls = [
    { id: "a", direction: "outbound", counterparty: ZIEL, status: "in_progress" },
    { id: "b", direction: "outbound", counterparty: ZIEL, status: "completed" },
    { id: "c", direction: "outbound", counterparty: "+4930555000100", status: "in_progress" },
    { id: "d", direction: "inbound", counterparty: ZIEL, status: "in_progress" },
    { id: "e", direction: "outbound", counterparty: ZIEL, status: "dialing" },
  ];
  const abfrage = async (_url, optionen) => {
    const { name, arguments: argumente } = JSON.parse(optionen.body).params;
    if (name === "cancel_call") abgebrochen.push(argumente.call_id);
    const ergebnis =
      name === "list_calls"
        ? { structuredContent: { calls } }
        : { content: [{ type: "text", text: JSON.stringify({ call_id: argumente.call_id, status: "cancelled" }) }] };
    const rpc = { jsonrpc: "2.0", id: 1, result: ergebnis };
    return { ok: true, status: 200, text: async () => JSON.stringify(rpc) };
  };
  const anrufer = anruferBauen({ basis: BASIS, token: PROBE_STAGING_TEST_TOKEN, ziel: ZIEL, sprache: "de", abfrage });
  assert.equal(await anrufer.offeneBeenden(), 2);
  assert.deepEqual(abgebrochen, ["a", "e"]);
});

test("auflegen: beendet offene Anrufe nur nach dem Zielschloss", async () => {
  const frei = await aufrufen({ argumente: ["auflegen"], fall: { offene: 2 } });
  assert.equal(frei.code, 0);
  assert.match(frei.ausgabe, /AUFGELEGT/);
  assert.match(frei.ausgabe, /probe_aufgelegt_2/);
  assert.ok(!frei.ausgabe.includes("ANRUF"));
  for (const umgebung of [{ STAGING_URL: "https://hermes.example.com" }]) {
    const gesperrt = await aufrufen({ argumente: ["auflegen"], umgebung });
    assert.equal(gesperrt.code, 1);
    assert.match(gesperrt.ausgabe, /probe_ziel_unerlaubt/);
    assert.ok(!gesperrt.ausgabe.includes("AUFGELEGT"));
  }
  const andereNummer = await aufrufen({ argumente: ["auflegen"], fall: { eigeneNummer: "+4930555000100" } });
  assert.equal(andereNummer.code, 1);
  assert.ok(!andereNummer.ausgabe.includes("AUFGELEGT"));
});

test("auflegen ohne Zielnummer: übersprungen und grün, nichts beendet", async () => {
  const ergebnis = await aufrufen({ argumente: ["auflegen"], umgebung: { STAGING_PROBE_ZIEL: "" } });
  assert.equal(ergebnis.code, 0);
  assert.match(ergebnis.ausgabe, /probe_uebersprungen_staging_probe_ziel_fehlt/);
  assert.ok(!ergebnis.ausgabe.includes("AUFGELEGT"));
});

test("Ohne Probe-Schlüssel von Telnyx: Probe läuft, ein Anruf, grün", async () => {
  const ergebnis = await aufrufen();
  assert.equal(ergebnis.code, 0);
  assert.match(ergebnis.ausgabe, /ANRUF 1/);
  assert.match(ergebnis.ausgabe, /Probe grün/);
  assert.match(ergebnis.ausgabe, new RegExp(`::add-mask::${ZIEL.replace("+", "\\+")}`));
});

test("Zeitplan-Lauf mit fehlendem Probe-Zugang oder Alarmweg ist rot, ohne Anruf", async () => {
  const faelle = [
    { umgebung: { GITHUB_EVENT_NAME: "schedule", STAGING_PROBE_ZIEL: "" }, name: "staging_probe_ziel" },
    { umgebung: { GITHUB_EVENT_NAME: "schedule", SLACK_ALERT_URL: "" }, name: "better_stack_alert_url" },
  ];
  for (const { umgebung, name } of faelle) {
    const ergebnis = await aufrufen({ umgebung });
    assert.equal(ergebnis.code, 1);
    assert.match(ergebnis.ausgabe, new RegExp(`probe_uebersprungen_${name}_fehlt`));
    assert.ok(!ergebnis.ausgabe.includes("ANRUF"));
  }
});

test("Push- und Handstart-Lauf mit fehlendem Probe-Zugang ist rot", async () => {
  for (const ereignis of ["push", "workflow_dispatch"]) {
    const ergebnis = await aufrufen({ umgebung: { GITHUB_EVENT_NAME: ereignis, STAGING_PROBE_ZIEL: "" } });
    assert.equal(ergebnis.code, 1);
    assert.match(ergebnis.ausgabe, /probe_uebersprungen_staging_probe_ziel_fehlt/);
  }
});

test("auflegen ohne Anrufer-Modul: nichts beendet, Lauf rot", async () => {
  const ergebnis = await aufrufen({ argumente: ["auflegen"], umgebung: { PROBE_ANRUFER_MODUL: "" } });
  assert.equal(ergebnis.code, 1);
  assert.match(ergebnis.ausgabe, /probe_anrufer_fehlt/);
});
