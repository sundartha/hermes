// Zweckbindung, Datenminimierung und Beratungsverbot (OpenAI Usage Policies / Plugin
// Guidelines) - am ECHTEN Draht geprueft, nie am registerTool-Konfigobjekt (das SDK verwirft
// unbekannte Felder still, ein Test darauf beweist nichts):
//   1. CALL_PURPOSE_RULE steht in der place_call-Beschreibung aus tools/list UND in den
//      instructions aus initialize - ueber HTTP /mcp (ohne und mit Consult) und ueber stdio.
//   2. Der Text schliesst die verbotenen Zwecke und die eingeschraenkten Daten ausdruecklich aus.
//   3. Das Beratungsverbot steht in jedem Sprach-Baustein, im gebauten System-Prompt beider
//      Richtungen und woertlich in der Agenten-Vorlage des Sprach-Anbieters.
//
// Testnamen tragen KEIN Katalog-/ABNAHME-Praefix (package.json i18nCatalogPattern/
// abnahmePattern), sonst landet dieser Test im falschen Lauf.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startServer, seedState, mcpPost, readToolResult, ROOT, BASE_ENV } from "./helpers.js";
import { CALL_PURPOSE_RULE } from "../src/call-purpose.js";
import { LOCALES } from "../src/i18n/locales.js";

const MCP_SERVER_ENTRYPOINT = "src/mcp-server.js";
const TEMPLATE_PATH = path.join(ROOT, "elevenlabs", "agent_configs", "outbound-agent.template.json");
const GOLDEN_PATH = path.join(ROOT, "test", "fixtures", "oc-p3-nichtowner-golden.json");
const CONSULT_ON = { CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" };
const TOOLS_LIST_BODY = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "call-purpose-client", version: "0.0.1" },
  },
};
const RAW_TOOLS_LIST_RESULT = z.object({ tools: z.array(z.any()) });

function adviceLineOf(lang) {
  const { boundaries } = LOCALES[lang].prompt;
  return boundaries.noLicensedAdvice;
}

function templatePromptText() {
  const { agent } = JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf8"));
  const { prompt } = agent.conversation_config.agent;
  return prompt.prompt;
}

function placeCallDescriptionOf(tools) {
  const tool = tools.find((candidate) => candidate.name === "place_call");
  assert.ok(tool, "place_call fehlt im tools/list");
  return tool.description;
}

async function httpWire(env) {
  const srv = await startServer({ seed: seedState({}), env });
  try {
    const init = await readToolResult(await mcpPost(`${srv.localUrl}/mcp`, null, INITIALIZE_BODY));
    const list = await readToolResult(await mcpPost(`${srv.localUrl}/mcp`, null, TOOLS_LIST_BODY));
    return { instructions: init.instructions, description: placeCallDescriptionOf(list.tools) };
  } finally {
    await srv.stop();
  }
}

async function stdioWire() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER_ENTRYPOINT],
    cwd: ROOT,
    env: { ...BASE_ENV },
    stderr: "pipe",
  });
  const client = new Client({ name: "call-purpose-stdio-client", version: "0.0.0" });
  try {
    await client.connect(transport);
    const list = await client.request({ method: "tools/list" }, RAW_TOOLS_LIST_RESULT);
    return { instructions: client.getInstructions(), description: placeCallDescriptionOf(list.tools) };
  } finally {
    await client.close();
  }
}

function assertCarriesRule(label, { instructions, description }) {
  assert.ok(description.includes(CALL_PURPOSE_RULE), `${label}: place_call-Beschreibung ohne Zweckbindung`);
  assert.equal(typeof instructions, "string", `${label}: instructions fehlen`);
  assert.ok(instructions.includes(CALL_PURPOSE_RULE), `${label}: instructions ohne Zweckbindung`);
}

test("Zweckbindung: der Text schliesst Werbung, Verkauf, Kampagnen und eingeschraenkte Daten aus", () => {
  for (const term of [
    "telemarketing",
    "advertising",
    "cold calls",
    "fundraising",
    "political campaigning",
    "lobbying",
    "election-related",
    "decline such requests",
    "not diagnoses or medical history",
    "government identification numbers",
  ]) {
    assert.ok(CALL_PURPOSE_RULE.includes(term), `Zweckbindung nennt "${term}" nicht`);
  }
});

test("Zweckbindung: HTTP /mcp ohne Consult traegt sie in tools/list und initialize", async () => {
  assertCarriesRule("HTTP ohne Consult", await httpWire({}));
});

test("Zweckbindung: HTTP /mcp mit Consult traegt sie in tools/list und initialize", async () => {
  assertCarriesRule("HTTP mit Consult", await httpWire(CONSULT_ON));
});

test("Zweckbindung: stdio traegt sie in tools/list und initialize", async () => {
  assertCarriesRule("stdio", await stdioWire());
});

// Der gebaute System-Prompt ist gegen dieses Golden byte-identisch gepinnt
// (test/callee-is-owner-opening.test.js, beide Richtungen, alle Sprachen) - enthaelt das
// Golden die Zeile, enthaelt sie der gebaute Prompt.
test("Beratungsverbot: jeder Sprach-Baustein fuehrt die Zeile, das Golden der gebauten Prompts beider Richtungen enthaelt sie", () => {
  const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8"));
  for (const [lang, byDirection] of Object.entries(golden.systemPrompt)) {
    const line = adviceLineOf(lang);
    assert.equal(typeof line, "string", `${lang}: noLicensedAdvice fehlt`);
    for (const [direction, prompt] of Object.entries(byDirection)) {
      assert.ok(prompt.includes(line), `${lang}/${direction}: Beratungsverbot fehlt im Prompt`);
    }
  }
});

test("Beratungsverbot: die Agenten-Vorlage des Sprach-Anbieters traegt den englischen Wortlaut", () => {
  const wording = adviceLineOf("en").replace(/^- /, "");
  assert.ok(templatePromptText().includes(wording), "Vorlage ohne Beratungsverbot oder mit abweichendem Wortlaut");
});
