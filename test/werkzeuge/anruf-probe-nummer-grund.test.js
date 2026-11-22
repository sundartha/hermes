import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  PROBE_STAGING_TEST_TOKEN,
  PROBE_TELNYX_SCHLUESSEL,
} from "../gemeinsam/erfundene-geheimnisse.js";

const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer-http.mjs", import.meta.url));
const NUMMER = "+12544670400";

async function lauf(fall) {
  const env = {
    PATH: process.env.PATH,
    GITHUB_SHA: "e".repeat(40),
    STAGING_URL: "https://hermes-staging-erpv.onrender.com",
    STAGING_PROBE_ZIEL: NUMMER,
    STAGING_PROBE_TELNYX_KEY: PROBE_TELNYX_SCHLUESSEL,
    STAGING_TEST_TOKEN: PROBE_STAGING_TEST_TOKEN,
    STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
    STAGING_PROBE_VORNAME: "Anna",
    SLACK_ALERT_URL: "http://127.0.0.1:1/x",
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_FALL: JSON.stringify(fall),
  };
  const kind = spawn("node", ["scripts/anruf-probe/probe.mjs"], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const code = await new Promise((fertig) => kind.on("close", fertig));
  const text = ausgabe
    .split("\n")
    .filter((zeile) => !zeile.startsWith("::add-mask::"))
    .join("\n");
  return { code, text };
}

const rpc = (result) => ({ jsonrpc: "2.0", id: 1, result });

const FAELLE = [
  ["HTTP 401", { status: 401, rpc: {} }, "nummer_nicht_lesbar grund=abruf_fehler mcp_http_401"],
  ["HTTP 503", { status: 503, rpc: {} }, "nummer_nicht_lesbar grund=abruf_fehler mcp_http_503"],
  [
    "MCP-Fehlerantwort",
    { status: 200, rpc: rpc({ isError: true, content: [{ type: "text", text: "nein" }] }) },
    "nummer_nicht_lesbar grund=abruf_fehler mcp_get_agent_number_fehlgeschlagen",
  ],
  [
    "Verbindungsfehler mit Token im Text",
    { status: 200, rpc: {}, wirft: `kaputt ${PROBE_STAGING_TEST_TOKEN}` },
    "nummer_nicht_lesbar grund=abruf_fehler unbekannt",
  ],
  [
    "Nummer null",
    { status: 200, rpc: rpc({ structuredContent: { number: null } }) },
    "nummer_nicht_lesbar grund=keine_nummer",
  ],
  [
    "Nummer fehlt im Ergebnis",
    { status: 200, rpc: rpc({ structuredContent: {} }) },
    "nummer_nicht_lesbar grund=keine_nummer",
  ],
  [
    "Nummer leer",
    { status: 200, rpc: rpc({ structuredContent: { number: "  " } }) },
    "nummer_nicht_lesbar grund=keine_nummer",
  ],
  [
    "Nummer als Zahl",
    { status: 200, rpc: rpc({ structuredContent: { number: 12544670400 } }) },
    "nummer_nicht_lesbar grund=kein_text",
  ],
];

for (const [name, fall, erwartet] of FAELLE) {
  test(`Anrufprobe nennt bei unlesbarer Nummer den Abrufgrund: ${name}`, async () => {
    const { code, text } = await lauf(fall);
    assert.equal(code, 1);
    assert.ok(text.split("\n").includes(erwartet), text);
    assert.ok(text.split("\n").includes("probe_ziel_unerlaubt: nummer_nicht_lesbar"), text);
    assert.equal(text.includes(PROBE_STAGING_TEST_TOKEN), false);
    assert.equal(text.includes("2544670"), false);
    assert.equal(text.includes("ANRUF"), false);
  });
}
