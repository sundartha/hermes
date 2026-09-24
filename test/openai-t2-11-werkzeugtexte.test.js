// T2-11 (N-11/N-12/N-13): ehrliche Werkzeug-Namen/Titel/Beschreibungen. Misst NUR den echten
// tools/list- bzw. resources/read-Output am Draht - nie das registerTool-Konfigobjekt
// (registerTool() des MCP-SDK verwirft unbekannte Felder still, ein Test darauf beweist
// nichts). Testname traegt KEIN Katalog-/ABNAHME-Praefix, sonst landet er im falschen Lauf.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  startServer,
  startIdp,
  seedState,
  seedCall,
  mcpPost,
  toolCall,
  readToolResult,
  ROOT,
  BASE_ENV,
} from "./helpers.js";

const MCP_SERVER_ENTRYPOINT = "src/mcp-server.js";
const CONSULT_ON = { CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" };
const TOOLS_LIST_BODY = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const RESOURCES_LIST_BODY = { jsonrpc: "2.0", id: 2, method: "resources/list" };
// Permissives Ergebnis-Schema fuer stdio ueber den typisierten SDK-Client: z.any() reicht
// jedes Feld unveraendert durch (title/annotations/_meta werden NICHT gestrippt).
const RAW_TOOLS_RESULT = z.object({ tools: z.array(z.any()) });
const RAW_RESOURCES_RESULT = z.object({ resources: z.array(z.any()) });
const RAW_RESOURCE_READ_RESULT = z.object({ contents: z.array(z.any()) });
// Alte, verbotene Namen - keine Konfiguration darf sie mehr liefern.
const OLD_NAMES = ["get_transcript", "get_my_number"];
const NEW_NAMES = ["get_call_result", "get_agent_number"];
const PROMOTIONAL_WORDS = /\b(best|official|pick_me|recommended)\b/i;
// visibleTexts() liefert description, title, annotations.title, invoking, invoked.
const MIN_VISIBLE_TEXTS = 4;

async function httpToolsList(baseUrl, token) {
  const res = await mcpPost(baseUrl, token, TOOLS_LIST_BODY);
  return (await readToolResult(res)).tools;
}

async function httpResourcesList(baseUrl, token) {
  const res = await mcpPost(baseUrl, token, RESOURCES_LIST_BODY);
  return (await readToolResult(res)).resources;
}

async function httpResourceRead(baseUrl, token, uri) {
  const res = await mcpPost(baseUrl, token, {
    jsonrpc: "2.0",
    id: 3,
    method: "resources/read",
    params: { uri },
  });
  return await readToolResult(res);
}

async function httpInitializeInstructions(baseUrl, token) {
  const res = await mcpPost(baseUrl, token, {
    jsonrpc: "2.0",
    id: 4,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t2-11-test-client", version: "0.0.0" },
    },
  });
  return (await readToolResult(res)).instructions;
}

function withStdioClient(env, run) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER_ENTRYPOINT],
    cwd: ROOT,
    env: { ...BASE_ENV, ...env },
    stderr: "pipe",
  });
  let stderrOutput = "";
  transport.stderr?.on("data", (chunk) => {
    stderrOutput += chunk.toString();
  });
  const client = new Client({ name: "t2-11-stdio-client", version: "0.0.0" });
  return client
    .connect(transport)
    .then(() => run(client, () => stderrOutput, transport))
    .finally(() => client.close());
}

async function stdioToolsList(client) {
  return (await client.request({ method: "tools/list" }, RAW_TOOLS_RESULT)).tools;
}

async function stdioResourcesList(client) {
  return (await client.request({ method: "resources/list" }, RAW_RESOURCES_RESULT)).resources;
}

async function stdioResourceRead(client, uri) {
  return await client.request(
    { method: "resources/read", params: { uri } },
    RAW_RESOURCE_READ_RESULT,
  );
}

// Alle sichtbaren Texte eines einzelnen Werkzeugs, an denen ein Client/Reviewer den Namen
// erkennen koennte - Grundlage fuer T11-b/T11-b2/T11-n.
function visibleTexts(tool) {
  const meta = tool._meta || {};
  return [
    tool.description,
    tool.title,
    tool.annotations?.title,
    meta["openai/toolInvocation/invoking"],
    meta["openai/toolInvocation/invoked"],
  ].filter((text) => typeof text === "string");
}

function findTool(tools, name) {
  const tool = tools.find((entry) => entry.name === name);
  assert.ok(tool, `Werkzeug ${name} fehlt im tools/list`);
  return tool;
}

// ==================== T11-a: Namensmenge je Pfad (Anwesenheit + Anzahl unveraendert) ====================

// Review-Nachtrag (cleancode/wichtig): die drei Pfade oben deckten den Draht-Wortlaut nie im
// HTTP-OAuth-Modus ab - genau dem Pfad, ueber den ChatGPT/OpenAI verbindet. Funktional war das
// schon durch test/am6-oauth-tenant.test.js belegt (get_agent_number liefert die Nummer), aber
// nicht der WORTLAUT (Titel/Beschreibung/invoking/invoked). Bindung auf den Bootstrap-Tenant
// (OWNER_IDP_SUBJECT, wie am6-oauth-tenant.test.js) statt eines frischen Tenants: ein frischer
// Tenant traegt DEFAULT_PROFILE (allowCalendar/allowConsult beide false, src/store/defaults.js)
// und liefert eine ANDERE Namensmenge - das wuerde die Legacy/OAuth-Gegenprobe unten verfaelschen,
// die exakt denselben Werkzeug-Wortlaut ueber beide Pfade sehen soll.
const OAUTH_SUBJECT = "sub-t2-11-werkzeugtexte";

const CONFIGS = [
  { label: "HTTP Legacy, ohne Consult", expectedCount: 10, run: (fn) => runLegacy({}, fn) },
  { label: "HTTP Legacy, mit Consult", expectedCount: 12, run: (fn) => runLegacy(CONSULT_ON, fn) },
  { label: "stdio", expectedCount: 10, run: (fn) => runStdio({}, fn) },
  { label: "HTTP OAuth", expectedCount: 10, run: (fn) => runOAuth(fn) },
];

async function runLegacy(env, fn) {
  const srv = await startServer({ seed: seedState({}), env });
  try {
    const tools = await httpToolsList(`${srv.localUrl}/mcp`, null);
    await fn(tools, { instructions: () => httpInitializeInstructions(`${srv.localUrl}/mcp`, null) });
  } finally {
    await srv.stop();
  }
}

async function runStdio(env, fn) {
  await withStdioClient(env, async (client) => {
    const tools = await stdioToolsList(client);
    await fn(tools, { instructions: () => Promise.resolve(client.getInstructions()) });
  });
}

async function runOAuth(fn, env = {}) {
  const idp = await startIdp();
  const srv = await startServer({
    seed: seedState({}),
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      MULTI_TENANT: "true",
      OWNER_IDP_SUBJECT: OAUTH_SUBJECT,
      ...env,
    },
  });
  try {
    const token = await idp.sign({ sub: OAUTH_SUBJECT });
    const tools = await httpToolsList(`${srv.localUrl}/mcp`, token);
    await fn(tools, { instructions: () => httpInitializeInstructions(`${srv.localUrl}/mcp`, token) });
  } finally {
    await srv.stop();
    await idp.close();
  }
}

test("T11-a: get_call_result/get_agent_number vorhanden, get_transcript/get_my_number fehlen, Anzahl unveraendert", async (subtests) => {
  for (const cfg of CONFIGS) {
    await subtests.test(cfg.label, async () => {
      await cfg.run(async (tools) => {
        assert.equal(tools.length, cfg.expectedCount, `${cfg.label}: Anzahl unveraendert`);
        const names = tools.map((tool) => tool.name);
        for (const newName of NEW_NAMES) {
          assert.ok(names.includes(newName), `${cfg.label}: ${newName} fehlt`);
        }
        for (const oldName of OLD_NAMES) {
          assert.ok(!names.includes(oldName), `${cfg.label}: ${oldName} ist noch registriert`);
        }
      });
    });
  }
});

// ==================== T11-b: sichtbare Texte tragen den neuen Wortlaut ====================

test("T11-b: get_call_result traegt in allen sichtbaren Texten kein /transcript/i ausser im Verneinungssatz", async (subtests) => {
  for (const cfg of CONFIGS) {
    await subtests.test(cfg.label, async () => {
      await cfg.run(async (tools) => {
        const tool = findTool(tools, "get_call_result");
        // Positiv-Kontrolle: VOR dem Herausschneiden traegt die Beschreibung mindestens
        // einen Treffer (der Verneinungssatz selbst) - sonst waere der Test wirkungslos.
        assert.match(tool.description, /transcript/i, "Positiv-Kontrolle: Verneinungssatz vorhanden");
        const withoutDenial = tool.description.replace(
          /This tool NEVER returns the raw transcript[^.]*\.\s?/,
          "",
        );
        assert.doesNotMatch(withoutDenial, /transcript/i, "description ausserhalb des Verneinungssatzes");
        for (const text of [tool.title, tool.annotations?.title]) {
          assert.doesNotMatch(text || "", /transcript/i, `${cfg.label}: Titel ohne "transcript"`);
        }
        const meta = tool._meta || {};
        assert.doesNotMatch(
          meta["openai/toolInvocation/invoking"] || "",
          /transcript/i,
          `${cfg.label}: invoking ohne "transcript"`,
        );
        assert.doesNotMatch(
          meta["openai/toolInvocation/invoked"] || "",
          /transcript/i,
          `${cfg.label}: invoked ohne "transcript"`,
        );
      });
    });
  }
});

test('T11-b: get_agent_number traegt in allen sichtbaren Texten /agent/i, nie /\\bmy\\b/i', async (subtests) => {
  for (const cfg of CONFIGS) {
    await subtests.test(cfg.label, async () => {
      await cfg.run(async (tools) => {
        const tool = findTool(tools, "get_agent_number");
        const texts = visibleTexts(tool);
        assert.ok(texts.length >= MIN_VISIBLE_TEXTS, `${cfg.label}: mindestens vier sichtbare Texte`);
        for (const text of texts) {
          assert.match(text, /agent/i, `${cfg.label}: "${text}" enthaelt "agent"`);
          assert.doesNotMatch(text, /\bmy\b/i, `${cfg.label}: "${text}" enthaelt nicht "my"`);
        }
      });
    });
  }
});

// ==================== T11-b2: Server-instructions und alle sichtbaren Texte ====================

test("T11-b2: instructions und alle sichtbaren Tool-Texte nennen die alten Namen nicht mehr", async (subtests) => {
  for (const cfg of CONFIGS) {
    await subtests.test(cfg.label, async () => {
      await cfg.run(async (tools, ctx) => {
        const instructions = await ctx.instructions();
        assert.equal(typeof instructions, "string");
        assert.ok(instructions.length > 0, `${cfg.label}: instructions nicht leer`);
        for (const oldName of OLD_NAMES) {
          assert.ok(!instructions.includes(oldName), `${cfg.label}: instructions nennen ${oldName} nicht`);
        }
        // Positiv-Kontrolle: der Basis-Block nennt den neuen Namen (jede Konfiguration
        // registriert get_call_result unbedingt, s. mcp-server-info.js).
        assert.ok(
          instructions.includes("get_call_result"),
          `${cfg.label}: instructions nennen get_call_result`,
        );
        for (const tool of tools) {
          for (const text of visibleTexts(tool)) {
            for (const oldName of OLD_NAMES) {
              assert.ok(
                !text.includes(oldName),
                `${cfg.label}: ${tool.name} zeigt noch "${oldName}" in "${text}"`,
              );
            }
          }
        }
      });
    });
  }
});

// ==================== T11-d (N-11): answer_consult nennt die Weitergabe (nur mit Consult) ====================
// Legacy UND OAuth (Review-Nachtrag): beide bauen die Werkzeug-Registrierung aus denselben
// TOOL_ANNOTATIONS/*_DESCRIPTION-Konstanten - dieselbe Begruendung wie bei CONFIGS oben.

const CONSULT_CONFIGS = [
  {
    label: "HTTP Legacy, mit Consult",
    run: async (fn) => {
      const srv = await startServer({ seed: seedState({}), env: CONSULT_ON });
      try {
        await fn(await httpToolsList(`${srv.localUrl}/mcp`, null));
      } finally {
        await srv.stop();
      }
    },
  },
  { label: "HTTP OAuth, mit Consult", run: (fn) => runOAuth(fn, CONSULT_ON) },
];

test("T11-d: answer_consult nennt die Weitergabe an die Gegenseite, nicht mehr 'background information only'", async (subtests) => {
  for (const cfg of CONSULT_CONFIGS) {
    await subtests.test(cfg.label, async () => {
      await cfg.run(async (tools) => {
        const tool = findTool(tools, "answer_consult");
        assert.match(
          tool.description,
          /The agent may relay your answer to the person on the call\./,
          "answer_consult nennt die Weitergabe woertlich",
        );
        assert.doesNotMatch(tool.description, /background information only/);
      });
    });
  }
});

// ==================== T11-e/T11-e2 (N-13): jedes Antwortfeld steht in der Beschreibung ====================
// Legacy UND OAuth (Review-Nachtrag, s. CONFIGS oben).

function assertDescribesEveryOutputKey(tool, { minKeys = [] } = {}) {
  const keys = Object.keys(tool.outputSchema?.properties || {});
  assert.ok(keys.length > 0, "Positiv-Kontrolle: outputSchema traegt Schluessel");
  for (const required of minKeys) {
    assert.ok(keys.includes(required), `Positiv-Kontrolle: ${required} dabei`);
  }
  for (const key of keys) {
    assert.ok(tool.description.includes(key), `description nennt Schluessel "${key}" nicht woertlich`);
  }
}

test("T11-e: get_agent_status nennt jeden Schluessel seines outputSchema in der Beschreibung", async (subtests) => {
  for (const cfg of CONFIGS) {
    await subtests.test(cfg.label, async () => {
      await cfg.run(async (tools) => {
        assertDescribesEveryOutputKey(findTool(tools, "get_agent_status"), {
          minKeys: ["planUsagePercent"],
        });
      });
    });
  }
});

test("T11-e2: get_call_result nennt jeden Schluessel seines outputSchema in der Beschreibung", async (subtests) => {
  for (const cfg of CONFIGS) {
    await subtests.test(cfg.label, async () => {
      await cfg.run(async (tools) => {
        assertDescribesEveryOutputKey(findTool(tools, "get_call_result"));
      });
    });
  }
});

// ==================== T11-f: tools/call - der Breaking Change ist am Verhalten belegt ====================

test("T11-f: tools/call get_call_result liefert genau die outputSchema-Schluessel, tools/call get_transcript liefert einen Fehler", async () => {
  const seed = seedState({
    calls: [
      seedCall({
        id: "call_t11f",
        status: "completed",
        transcript: [{ role: "agent", text: "Termin vereinbart." }],
        summary: "Termin vereinbart.",
        objectiveAchieved: true,
        result: {
          outcome: "Termin am Dienstag vereinbart.",
          commitments: ["Termin bestaetigt"],
          counterpartyCommitments: ["Ruft zurueck"],
          openPoints: [],
          nextStep: "Kalender eintragen",
        },
      }),
    ],
  });
  const srv = await startServer({ seed });
  try {
    const tools = await httpToolsList(`${srv.localUrl}/mcp`, null);
    const tool = findTool(tools, "get_call_result");
    const expectedKeys = Object.keys(tool.outputSchema?.properties || {}).sort();

    const okRes = await mcpPost(
      `${srv.localUrl}/mcp`,
      null,
      toolCall("get_call_result", { call_id: "call_t11f" }),
    );
    const okResult = await readToolResult(okRes);
    assert.ok(!okResult.isError, "get_call_result liefert kein Fehlerergebnis");
    assert.deepEqual(
      Object.keys(okResult.structuredContent).sort(),
      expectedKeys,
      "structuredContent traegt genau die outputSchema-Schluessel",
    );

    const errRes = await mcpPost(
      `${srv.localUrl}/mcp`,
      null,
      toolCall("get_transcript", { call_id: "call_t11f" }),
    );
    // readToolResult liest NUR .result - bei einem JSON-RPC-Fehler (kein .result-Feld) also
    // undefined; ein Tool-Fehler traegt dagegen .result.isError === true. Beides ist ein
    // Fehlerergebnis im MCP-Sinn, der Breaking Change verlangt keins von beidem bevorzugt.
    const errResult = await readToolResult(errRes);
    const isJsonRpcError = errResult === undefined;
    const isToolError = errResult?.isError === true;
    assert.ok(
      isJsonRpcError || isToolError,
      "get_transcript ist kein registriertes Werkzeug mehr - Fehler erwartet",
    );
    assert.equal(errResult?.structuredContent, undefined, "kein structuredContent fuer get_transcript");
  } finally {
    await srv.stop();
  }
});

// ==================== T11-r: jede _meta.ui.resourceUri loest auf (Widget-Verweise) ====================

test("T11-r: jede _meta.ui.resourceUri aus tools/list steht in resources/list und liefert per resources/read Inhalt", async (subtests) => {
  await subtests.test("HTTP Legacy", async () => {
    const srv = await startServer({ seed: seedState({}), env: { MCP_UI_ENABLED: "true" } });
    try {
      const tools = await httpToolsList(`${srv.localUrl}/mcp`, null);
      const resources = await httpResourcesList(`${srv.localUrl}/mcp`, null);
      const resourceUris = new Set(resources.map((resource) => resource.uri));
      const widgetTools = tools.filter((tool) => tool._meta?.ui?.resourceUri);
      assert.ok(widgetTools.length > 0, "Positiv-Kontrolle: mindestens ein Widget-Werkzeug");
      const agentNumber = findTool(tools, "get_agent_number");
      assert.ok(agentNumber._meta?.ui?.resourceUri, "get_agent_number traegt eine resourceUri");
      for (const tool of widgetTools) {
        const uri = tool._meta.ui.resourceUri;
        assert.ok(resourceUris.has(uri), `${tool.name}: resourceUri ${uri} steht in resources/list`);
        const read = await httpResourceRead(`${srv.localUrl}/mcp`, null, uri);
        assert.ok(read.contents?.length > 0, `${tool.name}: resources/read liefert Inhalt`);
      }
    } finally {
      await srv.stop();
    }
  });

  await subtests.test("stdio", async () => {
    await withStdioClient({ MCP_UI_ENABLED: "true" }, async (client) => {
      const tools = await stdioToolsList(client);
      const resources = await stdioResourcesList(client);
      const resourceUris = new Set(resources.map((resource) => resource.uri));
      const widgetTools = tools.filter((tool) => tool._meta?.ui?.resourceUri);
      assert.ok(widgetTools.length > 0, "Positiv-Kontrolle: mindestens ein Widget-Werkzeug");
      for (const tool of widgetTools) {
        const uri = tool._meta.ui.resourceUri;
        assert.ok(resourceUris.has(uri), `${tool.name}: resourceUri ${uri} steht in resources/list`);
        const read = await stdioResourceRead(client, uri);
        assert.ok(read.contents?.length > 0, `${tool.name}: resources/read liefert Inhalt`);
      }
    });
  });
});

// ==================== T11-n (N-12): keine werblich/vergleichende Sprache in Namen/Titeln ====================
// Legacy UND OAuth (Review-Nachtrag, s. CONFIGS oben).

test("T11-n: kein Werkzeugname und kein Titel traegt best/official/pick_me/recommended", async (subtests) => {
  for (const cfg of CONSULT_CONFIGS) {
    await subtests.test(cfg.label, async () => {
      await cfg.run(async (tools) => {
        for (const tool of tools) {
          assert.doesNotMatch(
            tool.name,
            PROMOTIONAL_WORDS,
            `${tool.name}: Name ohne Werbe-/Vergleichssprache`,
          );
          if (tool.title) {
            assert.doesNotMatch(
              tool.title,
              PROMOTIONAL_WORDS,
              `${tool.name}: Titel ohne Werbe-/Vergleichssprache`,
            );
          }
        }
      });
    });
  }
});
