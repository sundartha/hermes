// P1 MCP Rich-UI duenne Scheibe: get_call_status auf Stufe 0 (structuredContent +
// schema-validiert) + Stufe 1 (ui://-Resource fuer faehige Hosts) mit fail-closed
// Fallback. Kein echter MCP-Transport/Host: ein fakeServer faengt registerTool-
// (config inkl. outputSchema/_meta) + registerResource-Aufrufe ein, ein lokaler
// HTTP-Mock spielt das Gateway (Spec Abschnitt 8 - Seam beweist sich ueber Tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { z } from "zod";
import { registerTools } from "../src/mcp-tools.js";
import { uiRendererFor } from "../src/ui/registry.js";
import { mcpNativeRenderer, WIDGET_CALL_STATUS, WIDGET_TRANSCRIPT } from "../src/ui/adapters/mcp-native.js";
import { chatgptRenderer } from "../src/ui/adapters/chatgpt.js";
import {
  UI_MIME,
  CHATGPT_UI_MIME,
  CHATGPT_META_KEY,
  capabilityDeclaresUi,
  capabilityDeclaresChatgptUi,
  uiResourceUri,
} from "../src/ui/contract.js";

const RESOURCE_URI = uiResourceUri(WIDGET_CALL_STATUS); // ui://hermes/call-status
const RESOURCE_URI_TRANSCRIPT = uiResourceUri(WIDGET_TRANSCRIPT); // ui://hermes/transcript

// Faehiger Host: deklariert die UI-Capability mit UI_MIME (SEP-1865 initialize).
const CAPABLE_CAPS = {
  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [UI_MIME] } },
};
const capableHost = () => ({ enabled: true, capabilities: CAPABLE_CAPS });

// Faengt registerTool(name, config, handler) + registerResource(name, uri, config,
// readCb) ein. tool() (Bestand) faengt es ueber server.tool ab (hier ungenutzt).
function captureUi(ctx) {
  const tools = new Map(); // name -> { config, handler }
  const resources = []; // { name, uri, config, readCallback }
  const fakeServer = {
    tool(name, _desc, _schema, handler) {
      tools.set(name, { config: null, handler });
    },
    registerTool(name, config, handler) {
      tools.set(name, { config, handler });
    },
    registerResource(name, uri, config, readCallback) {
      resources.push({ name, uri, config, readCallback });
    },
  };
  registerTools(fakeServer, ctx);
  return { tools, resources };
}

// Gateway-Mock mit konfigurierbarem Body je Pfad (Default = ein laufender Call mit
// PII-Zusatzfeldern fuer den Whitelist-Test).
const RICH_CALL = {
  status: "active",
  answeredAt: "2026-06-26T10:00:00.000Z",
  startedAt: "2026-06-26T09:59:50.000Z",
  transcript: [
    { role: "agent", text: "Guten Tag, hier ist Hermes.", at: "2026-06-26T10:00:01.000Z" },
    { role: "callee", text: "Hallo, worum geht es?", at: "2026-06-26T10:00:05.000Z" },
  ],
  // Felder, die NIEMALS nach aussen duerfen (Whitelist-Test AC4):
  email: "secret@example.com",
  apiKey: "sk_live_LEAK",
  tenantId: "tenant-XYZ",
  audioUrl: "https://example.com/recording.wav",
};

async function startGatewayMock(body) {
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

async function withGateway(body, fn) {
  const mock = await startGatewayMock(body);
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
}

const callStatusOutput = z.object({
  call_id: z.string(),
  status: z.string(),
  duration_s: z.number(),
  last_transcript_lines: z.array(z.string()),
});

test("T-P1-UI-AC1: Stufe 0 additiv - Textblock (3 Felder) + schema-validiertes structuredContent", async () => {
  await withGateway(RICH_CALL, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { config, handler } = tools.get("get_call_status");
    assert.ok(config.outputSchema, "outputSchema am config deklariert");
    const result = await handler({ call_id: "call_1" });

    assert.equal(result.content[0].type, "text", "Textblock bleibt erhalten");
    const textObj = JSON.parse(result.content[0].text);
    assert.deepEqual(
      Object.keys(textObj).sort(),
      ["duration_s", "last_transcript_lines", "status"],
      "Textblock unveraendert: genau die heutige 3-Feld-Sicht",
    );

    assert.ok(result.structuredContent, "structuredContent vorhanden");
    assert.deepEqual(Object.keys(result.structuredContent).sort(), [
      "call_id",
      "duration_s",
      "last_transcript_lines",
      "status",
    ]);
    assert.equal(result.structuredContent.call_id, "call_1");
    assert.equal(result.structuredContent.status, "in_progress");
    assert.doesNotThrow(
      () => callStatusOutput.parse(result.structuredContent),
      "structuredContent validiert gegen outputSchema",
    );
  });
});

test("T-P1-UI-AC2: Stufe 1 (faehiger Host) - genau eine ui://-Resource + _meta zeigt darauf", async () => {
  await withGateway(RICH_CALL, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const callStatusResources = resources.filter((r) => r.uri === RESOURCE_URI);
    assert.equal(callStatusResources.length, 1, "genau eine Resource-Registrierung");
    assert.equal(callStatusResources[0].config.mimeType, UI_MIME);

    const { config } = tools.get("get_call_status");
    assert.equal(config._meta.ui.resourceUri, RESOURCE_URI, "_meta zeigt auf dieselbe URI");
  });
});

test("T-P1-UI-AC3: Fallback fail-closed - kein _meta, keine Resource, structuredContent voll", async () => {
  const cases = {
    "stdio (uiHost=null)": null,
    "enabled aber Capability fehlt": { enabled: true, capabilities: {} },
    "Master-Schalter aus trotz Capability": { enabled: false, capabilities: CAPABLE_CAPS },
    "unbekannter Host (fremder mimeType)": {
      enabled: true,
      capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html"] } } },
    },
  };
  await withGateway(RICH_CALL, async () => {
    for (const [label, uiHost] of Object.entries(cases)) {
      const { tools, resources } = captureUi(uiHost === null ? undefined : { uiHost });
      const { config, handler } = tools.get("get_call_status");
      assert.equal(resources.length, 0, `${label}: keine Resource`);
      assert.ok(!config._meta, `${label}: kein _meta`);
      const result = await handler({ call_id: "call_1" });
      assert.ok(result.structuredContent, `${label}: structuredContent bleibt`);
      assert.equal(result.structuredContent.call_id, "call_1");
    }
  });
});

test("T-P1-UI-AC4: Whitelist - keine fremden/PII-Felder in structuredContent/Text/Resource", async () => {
  await withGateway(RICH_CALL, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_call_status");
    const result = await handler({ call_id: "call_1" });

    const serialized = JSON.stringify(result);
    for (const leak of ["secret@example.com", "sk_live_LEAK", "tenant-XYZ", "recording.wav"]) {
      assert.ok(!serialized.includes(leak), `kein Leck von ${leak} im Tool-Result`);
    }
    assert.deepEqual(Object.keys(result.structuredContent).sort(), [
      "call_id",
      "duration_s",
      "last_transcript_lines",
      "status",
    ]);

    // Resource-HTML ist statisch -> enthaelt per Konstruktion keine Call-Daten.
    const readback = await resources[0].readCallback();
    const html = readback.contents[0].text;
    for (const leak of ["secret@example.com", "sk_live_LEAK", "tenant-XYZ", "recording.wav"]) {
      assert.ok(!html.includes(leak), `Resource-HTML statisch, kein ${leak}`);
    }
  });
});

test("T-P1-UI-AC5: Fehlerpfad - degradierte Antwort -> isError, text-only, auch bei faehigem Host", async () => {
  // Body ohne transcript -> requireFields wirft -> wrapHandler liefert isError.
  await withGateway({ status: "active" }, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_call_status");
    const result = await handler({ call_id: "call_1" });
    assert.ok(result.isError, "degradierte Antwort -> isError");
    assert.ok(!result.structuredContent, "Fehlerpfad ohne structuredContent");
    const txt = result.content.map((c) => c.text).join("\n");
    assert.doesNotMatch(txt, /Cannot read|undefined|TypeError/i, "generischer, provider-freier Text");
  });
});

test("T-P1-UI-AC6: Widget self-contained - kein @import/Linkback, @dsCard-Marker, readback=UI_MIME", async () => {
  const readback = await new Promise((resolve) => {
    const fakeServer = {
      registerResource(_name, _uri, _config, readCallback) {
        resolve(readCallback());
      },
    };
    mcpNativeRenderer.registerResource(fakeServer, WIDGET_CALL_STATUS);
  });
  const content = readback.contents[0];
  assert.equal(content.mimeType, UI_MIME);
  const html = content.text;
  assert.ok(html.startsWith("<!-- @dsCard"), "@dsCard-Marker in Zeile 1");
  assert.ok(!html.includes("@import"), "kein @import");
  assert.doesNotMatch(html, /<link[\s>]/, "kein <link>-Element");
  assert.doesNotMatch(html, /href\s*=/, "kein href-Linkback");
});

test("T-P1-UI-seam: uiRendererFor + Adapter + capabilityDeclaresUi Grenzfaelle", () => {
  assert.equal(uiRendererFor({ enabled: false, capabilities: CAPABLE_CAPS }), null);
  assert.equal(uiRendererFor(capableHost()), mcpNativeRenderer);
  assert.equal(
    uiRendererFor({
      enabled: true,
      capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html"] } } },
    }),
    null,
    "fremder mimeType -> null",
  );
  assert.equal(uiRendererFor(null), null, "kein hostHint -> null");

  assert.equal(mcpNativeRenderer.hasWidget(WIDGET_CALL_STATUS), true);
  assert.equal(mcpNativeRenderer.hasWidget("unknown"), false);

  assert.equal(capabilityDeclaresUi(undefined), false, "Grenzfall: undefined -> false");
  assert.equal(capabilityDeclaresUi({}), false);
});

// ===== P2: get_transcript ueber den BESTEHENDEN Seam (Seam-Wiederverwendung) =====
// Datensatz eines ABGESCHLOSSENEN Calls MIT Roh-Transkript-Zeilen + Summary/Ziel +
// PII. Der Whitelist-Test beweist, dass NUR Summary/objective/call_id durchkommen,
// das Roh-Transkript NIE - auch wenn der Datensatz es noch traegt (DSGVO).
const RICH_TRANSCRIPT = {
  status: "completed",
  summary: "Termin Donnerstag 14:30 bei Salon Bella gebucht.",
  objectiveAchieved: true,
  transcript: [
    { role: "agent", text: "Guten Tag, ich rufe im Auftrag von Antonio an.", at: "2026-06-26T10:00:01.000Z" },
    { role: "callee", text: "Donnerstag 14:30 koennen wir machen.", at: "2026-06-26T10:00:05.000Z" },
  ],
  // Felder, die NIEMALS nach aussen duerfen (Whitelist-Test):
  email: "secret@example.com",
  apiKey: "sk_live_LEAK",
  tenantId: "tenant-XYZ",
  audioUrl: "https://example.com/recording.wav",
};

const transcriptOutput = z.object({
  call_id: z.string(),
  result_summary: z.string(),
  objective_achieved: z.union([z.boolean(), z.string()]),
});

test("T-P2-UI-AC1: Stufe 0 additiv - Textblock (Summary/Ziel) + schema-validiertes structuredContent", async () => {
  await withGateway(RICH_TRANSCRIPT, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { config, handler } = tools.get("get_transcript");
    assert.ok(config.outputSchema, "outputSchema am config deklariert");
    const result = await handler({ call_id: "call_1" });

    assert.equal(result.content[0].type, "text", "Textblock bleibt erhalten");
    const textObj = JSON.parse(result.content[0].text);
    assert.deepEqual(
      Object.keys(textObj).sort(),
      ["objective_achieved", "result_summary"],
      "Textblock: Summary/Ziel-Sicht ohne call_id (kein Roh-Transkript)",
    );

    assert.ok(result.structuredContent, "structuredContent vorhanden");
    assert.deepEqual(Object.keys(result.structuredContent).sort(), [
      "call_id",
      "objective_achieved",
      "result_summary",
    ]);
    assert.equal(result.structuredContent.call_id, "call_1");
    assert.equal(result.structuredContent.objective_achieved, true);
    assert.doesNotThrow(
      () => transcriptOutput.parse(result.structuredContent),
      "structuredContent validiert gegen outputSchema",
    );
  });
});

test("T-P2-UI-AC2: Stufe 1 (faehiger Host) - genau eine transcript-Resource + _meta zeigt darauf", async () => {
  await withGateway(RICH_TRANSCRIPT, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const transcriptResources = resources.filter((r) => r.uri === RESOURCE_URI_TRANSCRIPT);
    assert.equal(transcriptResources.length, 1, "genau eine transcript-Resource");
    assert.equal(transcriptResources[0].config.mimeType, UI_MIME);

    const { config } = tools.get("get_transcript");
    assert.equal(config._meta.ui.resourceUri, RESOURCE_URI_TRANSCRIPT, "_meta zeigt auf dieselbe URI");
  });
});

test("T-P2-UI-AC3: Fallback fail-closed - kein _meta, keine transcript-Resource, structuredContent voll", async () => {
  const cases = {
    "stdio (uiHost=null)": null,
    "enabled aber Capability fehlt": { enabled: true, capabilities: {} },
    "Master-Schalter aus trotz Capability": { enabled: false, capabilities: CAPABLE_CAPS },
    "unbekannter Host (fremder mimeType)": {
      enabled: true,
      capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html"] } } },
    },
  };
  await withGateway(RICH_TRANSCRIPT, async () => {
    for (const [label, uiHost] of Object.entries(cases)) {
      const { tools, resources } = captureUi(uiHost === null ? undefined : { uiHost });
      const { config, handler } = tools.get("get_transcript");
      assert.equal(
        resources.filter((r) => r.uri === RESOURCE_URI_TRANSCRIPT).length,
        0,
        `${label}: keine transcript-Resource`,
      );
      assert.ok(!config._meta, `${label}: kein _meta`);
      const result = await handler({ call_id: "call_1" });
      assert.ok(result.structuredContent, `${label}: structuredContent bleibt`);
      assert.equal(result.structuredContent.call_id, "call_1");
    }
  });
});

test("T-P2-UI-AC4: Whitelist (DSGVO) - Roh-Transkript NIE in structuredContent/Text/Resource", async () => {
  await withGateway(RICH_TRANSCRIPT, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_transcript");
    const result = await handler({ call_id: "call_1" });

    const serialized = JSON.stringify(result);
    // Roh-Transkript-Zeilen (role/text) UND PII duerfen NIRGENDS auftauchen.
    for (const leak of [
      "Donnerstag 14:30 koennen wir machen.",
      "ich rufe im Auftrag von Antonio an",
      "callee",
      "secret@example.com",
      "sk_live_LEAK",
      "tenant-XYZ",
      "recording.wav",
    ]) {
      assert.ok(!serialized.includes(leak), `kein Leck von "${leak}" im Tool-Result`);
    }
    assert.deepEqual(Object.keys(result.structuredContent).sort(), [
      "call_id",
      "objective_achieved",
      "result_summary",
    ]);

    // Resource-HTML ist statisch -> enthaelt per Konstruktion keine Call-Daten.
    const transcriptRes = resources.find((r) => r.uri === RESOURCE_URI_TRANSCRIPT);
    const html = (await transcriptRes.readCallback()).contents[0].text;
    for (const leak of ["Donnerstag 14:30", "secret@example.com", "sk_live_LEAK", "tenant-XYZ"]) {
      assert.ok(!html.includes(leak), `Resource-HTML statisch, kein ${leak}`);
    }
  });
});

test("T-P2-UI-AC5: Fehlerpfad - degradierte Antwort -> isError, text-only, auch bei faehigem Host", async () => {
  // Body ohne transcript -> requireFields wirft -> wrapHandler liefert isError.
  await withGateway({ status: "completed" }, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_transcript");
    const result = await handler({ call_id: "call_1" });
    assert.ok(result.isError, "degradierte Antwort -> isError");
    assert.ok(!result.structuredContent, "Fehlerpfad ohne structuredContent");
    const txt = result.content.map((c) => c.text).join("\n");
    assert.doesNotMatch(txt, /Cannot read|undefined|TypeError/i, "generischer, provider-freier Text");
  });
});

test("T-P2-UI-AC6: transcript.html self-contained - kein @import/Linkback, @dsCard, readback=UI_MIME", async () => {
  const readback = await new Promise((resolve) => {
    const fakeServer = {
      registerResource(_name, _uri, _config, readCallback) {
        resolve(readCallback());
      },
    };
    mcpNativeRenderer.registerResource(fakeServer, WIDGET_TRANSCRIPT);
  });
  const content = readback.contents[0];
  assert.equal(content.mimeType, UI_MIME);
  const html = content.text;
  assert.ok(html.startsWith("<!-- @dsCard"), "@dsCard-Marker in Zeile 1");
  assert.ok(!html.includes("@import"), "kein @import");
  assert.doesNotMatch(html, /<link[\s>]/, "kein <link>-Element");
  assert.doesNotMatch(html, /href\s*=/, "kein href-Linkback");
  assert.equal(mcpNativeRenderer.hasWidget(WIDGET_TRANSCRIPT), true, "Adapter kennt transcript");
});

// ===== P3: zweiter Host-Adapter (ChatGPT Apps SDK) hinter dem UiRenderer-Port =====
// Beweist: dasselbe Widget rendert in BEIDEN Host-Konventionen; der mcp-native Pfad
// bleibt byte-kompatibel (die P1/P2-Tests oben sind unveraendert), nur die Host-eigene
// _meta-Form + der mimeType unterscheiden sich.
const CHATGPT_CAPS = {
  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [CHATGPT_UI_MIME] } },
};
const chatgptHost = () => ({ enabled: true, capabilities: CHATGPT_CAPS });

// Liest die statische ui://-Resource eines Renderers fuer ein Widget zurueck (readback).
function readbackResource(renderer, widgetId) {
  return new Promise((resolve) => {
    const fakeServer = {
      registerResource(_name, _uri, _config, readCallback) {
        resolve(readCallback());
      },
    };
    renderer.registerResource(fakeServer, widgetId);
  });
}

const P3_WIDGETS = [
  { tool: "get_call_status", widgetId: WIDGET_CALL_STATUS, body: RICH_CALL },
  { tool: "get_transcript", widgetId: WIDGET_TRANSCRIPT, body: RICH_TRANSCRIPT },
];

test("T-P3-AC1: beide Widgets, mcp-nativer Host - eine Resource je Tool + _meta.ui.resourceUri", async () => {
  for (const { tool, widgetId, body } of P3_WIDGETS) {
    await withGateway(body, async () => {
      const { tools, resources } = captureUi({ uiHost: capableHost() });
      const uri = uiResourceUri(widgetId);
      const matching = resources.filter((r) => r.uri === uri);
      assert.equal(matching.length, 1, `${tool}: genau eine Resource`);
      assert.equal(matching[0].config.mimeType, UI_MIME);
      assert.equal(tools.get(tool).config._meta.ui.resourceUri, uri, `${tool}: _meta zeigt darauf`);
    });
  }
});

test("T-P3-AC2: beide Widgets, ChatGPT-Host - eine Resource je Tool + flaches openai/outputTemplate", async () => {
  for (const { tool, widgetId, body } of P3_WIDGETS) {
    await withGateway(body, async () => {
      const capable = captureUi({ uiHost: capableHost() });
      const chat = captureUi({ uiHost: chatgptHost() });
      const uri = uiResourceUri(widgetId);
      const matching = chat.resources.filter((r) => r.uri === uri);
      assert.equal(matching.length, 1, `${tool}: genau eine Resource`);
      assert.equal(matching[0].config.mimeType, CHATGPT_UI_MIME);
      const meta = chat.tools.get(tool).config._meta;
      assert.equal(meta[CHATGPT_META_KEY], uri, `${tool}: flacher String unter openai/outputTemplate`);
      assert.ok(!meta.ui, `${tool}: kein verschachteltes _meta.ui (das ist mcp-nativ)`);

      // Stufe 0 (structuredContent) ist host-UNabhaengig -> identische Keys.
      const a = await capable.tools.get(tool).handler({ call_id: "call_1" });
      const b = await chat.tools.get(tool).handler({ call_id: "call_1" });
      assert.deepEqual(
        Object.keys(b.structuredContent).sort(),
        Object.keys(a.structuredContent).sort(),
        `${tool}: structuredContent-Keys host-unabhaengig identisch`,
      );
    });
  }
});

test("T-P3-AC3: Registry waehlt GENAU EINEN Adapter pro Host, fail-closed", () => {
  assert.equal(uiRendererFor(capableHost()), mcpNativeRenderer, "mcp-nativer Host -> mcp-native");
  assert.equal(uiRendererFor(chatgptHost()), chatgptRenderer, "ChatGPT-Host -> chatgpt");
  assert.equal(
    uiRendererFor({
      enabled: true,
      capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html"] } } },
    }),
    null,
    "fremder mimeType -> null",
  );
  assert.equal(uiRendererFor({ enabled: false, capabilities: CHATGPT_CAPS }), null, "Master-Schalter aus -> null");
  assert.equal(uiRendererFor(null), null, "kein hostHint -> null");
});

test("T-P3-AC4: Whitelist unveraendert auch im ChatGPT-Pfad (kein PII-/Audio-Leck)", async () => {
  const leaks = {
    get_call_status: ["secret@example.com", "sk_live_LEAK", "tenant-XYZ", "recording.wav"],
    get_transcript: [
      "Donnerstag 14:30 koennen wir machen.",
      "ich rufe im Auftrag von Antonio an",
      "callee",
      "secret@example.com",
      "sk_live_LEAK",
      "tenant-XYZ",
      "recording.wav",
    ],
  };
  for (const { tool, body } of P3_WIDGETS) {
    await withGateway(body, async () => {
      const capable = captureUi({ uiHost: capableHost() });
      const chat = captureUi({ uiHost: chatgptHost() });
      const a = await capable.tools.get(tool).handler({ call_id: "call_1" });
      const b = await chat.tools.get(tool).handler({ call_id: "call_1" });
      const serialized = JSON.stringify(b);
      for (const leak of leaks[tool]) {
        assert.ok(!serialized.includes(leak), `${tool}: kein Leck von "${leak}" im ChatGPT-Result`);
      }
      assert.deepEqual(
        Object.keys(b.structuredContent).sort(),
        Object.keys(a.structuredContent).sort(),
        `${tool}: structuredContent-Keys exakt wie mcp-nativ`,
      );
    });
  }
});

test("T-P3-AC5: gleiche Widget-Bytes in beiden Hosts (Resource-HTML byte-genau)", async () => {
  for (const { widgetId } of P3_WIDGETS) {
    const nativeBack = await readbackResource(mcpNativeRenderer, widgetId);
    const chatBack = await readbackResource(chatgptRenderer, widgetId);
    assert.equal(chatBack.contents[0].mimeType, CHATGPT_UI_MIME, "ChatGPT-readback mimeType");
    const nativeHtml = nativeBack.contents[0].text;
    const chatHtml = chatBack.contents[0].text;
    assert.equal(chatHtml, nativeHtml, `${widgetId}: identische Widget-Bytes in beiden Hosts`);
    assert.ok(chatHtml.startsWith("<!-- @dsCard"), "@dsCard-Marker in Zeile 1");
    assert.ok(!chatHtml.includes("@import"), "kein @import");
    assert.doesNotMatch(chatHtml, /<link[\s>]/, "kein <link>-Element");
    assert.doesNotMatch(chatHtml, /href\s*=/, "kein href-Linkback");
  }
});

test("T-P3-AC6: chatgptRenderer-Grenzfaelle + Detektor", () => {
  assert.equal(chatgptRenderer.hasWidget(WIDGET_CALL_STATUS), true);
  assert.equal(chatgptRenderer.hasWidget(WIDGET_TRANSCRIPT), true);
  assert.equal(chatgptRenderer.hasWidget("unknown"), false);
  assert.equal(chatgptRenderer.mimeType, CHATGPT_UI_MIME);

  assert.equal(capabilityDeclaresChatgptUi(undefined), false, "Grenzfall: undefined -> false");
  assert.equal(capabilityDeclaresChatgptUi({}), false);
  // Detektoren disjunkt: ein mcp-nativer Host ist KEIN ChatGPT-Host und umgekehrt.
  assert.equal(capabilityDeclaresChatgptUi(CAPABLE_CAPS), false, "mcp-Caps -> kein ChatGPT");
  assert.equal(capabilityDeclaresUi(CHATGPT_CAPS), false, "ChatGPT-Caps -> kein mcp-nativ");
});
