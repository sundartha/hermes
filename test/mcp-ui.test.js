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
import {
  mcpNativeRenderer,
  WIDGET_CALL_STATUS,
  WIDGET_CALL_RESULT,
  WIDGET_TRANSCRIPT,
  WIDGET_AGENT_STATUS,
} from "../src/ui/adapters/mcp-native.js";
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
  // requests: Mitschnitt der eingehenden Requests (method/url/headers) fuer den
  // Callback-Beweis (P4-AC5: cancel_call laeuft als authentisierter POST auf den
  // bestehenden /cancel-Pfad, kein Seitenkanal). Additiv - Bestandsaufrufer ignorieren.
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}

async function withGateway(body, fn) {
  return withGatewayCapture(body, () => fn());
}

// Wie withGateway, reicht aber den Mock an fn (fuer den Request-Mitschnitt, AC5).
async function withGatewayCapture(body, fn) {
  const mock = await startGatewayMock(body);
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    return await fn(mock);
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

// ===== P4: erstes Callback-Widget (get_call_result + cancel_call, hartes Safety-Gate) =====
// get_call_result ist read-only und teilt den get_call_status-Datenkontrakt (geteilter
// Helper); der Widget-Button ruft cancel_call als NORMALEN, authentisierten MCP-Tool-
// Call zurueck (kein Seitenkanal). Das Tool existiert NUR bei faehigem Rich-UI-Host
// (sonst byte-identische Tool-Liste). DoD(b) - fremder Tenant kann fremden Call nicht
// abbrechen - ist serverseitig in test/i6-write-scope.test.js bewiesen (Endpunkt in P4
// unveraendert) und wird hier bewusst NICHT dupliziert.
const RESOURCE_URI_RESULT = uiResourceUri(WIDGET_CALL_RESULT); // ui://hermes/call-result

test("T-P4-UI-AC1: Stufe 0 - structuredContent + Text exakt wie get_call_status (geteilter Helper)", async () => {
  await withGateway(RICH_CALL, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { config, handler } = tools.get("get_call_result");
    assert.ok(config.outputSchema, "outputSchema am config deklariert");
    const result = await handler({ call_id: "call_1" });

    assert.equal(result.content[0].type, "text", "Textblock vorhanden");
    const textObj = JSON.parse(result.content[0].text);
    assert.deepEqual(
      Object.keys(textObj).sort(),
      ["duration_s", "last_transcript_lines", "status"],
      "Textblock: dieselbe 3-Feld-Sicht wie get_call_status",
    );

    assert.deepEqual(Object.keys(result.structuredContent).sort(), [
      "call_id",
      "duration_s",
      "last_transcript_lines",
      "status",
    ]);
    assert.doesNotThrow(
      () => callStatusOutput.parse(result.structuredContent),
      "structuredContent validiert gegen outputSchema",
    );

    // Beweis des geteilten Helpers: identische Keys wie get_call_status.
    const statusResult = await tools.get("get_call_status").handler({ call_id: "call_1" });
    assert.deepEqual(
      Object.keys(result.structuredContent).sort(),
      Object.keys(statusResult.structuredContent).sort(),
      "structuredContent-Keys identisch zu get_call_status",
    );
  });
});

test("T-P4-UI-AC2: Stufe 1 (faehiger Host) - genau eine call-result-Resource + _meta zeigt darauf", async () => {
  await withGateway(RICH_CALL, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const resultResources = resources.filter((r) => r.uri === RESOURCE_URI_RESULT);
    assert.equal(resultResources.length, 1, "genau eine call-result-Resource");
    assert.equal(resultResources[0].config.mimeType, UI_MIME);

    const { config } = tools.get("get_call_result");
    assert.equal(config._meta.ui.resourceUri, RESOURCE_URI_RESULT, "_meta zeigt auf dieselbe URI");
  });
});

test("T-P4-UI-AC3: fail-closed - ohne faehigen Rich-UI-Host existiert get_call_result GAR NICHT", async () => {
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
      assert.equal(tools.has("get_call_result"), false, `${label}: Tool existiert nicht`);
      assert.equal(
        resources.filter((r) => r.uri === RESOURCE_URI_RESULT).length,
        0,
        `${label}: keine call-result-Resource`,
      );
      // get_call_status bleibt unberuehrt verfuegbar (Tool-Liste byte-identisch zu heute).
      assert.equal(tools.has("get_call_status"), true, `${label}: get_call_status bleibt`);
    }
  });
});

test("T-P4-UI-AC4: Whitelist - keine fremden/PII-Felder in structuredContent/Text/Resource", async () => {
  await withGateway(RICH_CALL, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_call_result");
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

    const resultRes = resources.find((r) => r.uri === RESOURCE_URI_RESULT);
    const html = (await resultRes.readCallback()).contents[0].text;
    for (const leak of ["secret@example.com", "sk_live_LEAK", "tenant-XYZ", "recording.wav"]) {
      assert.ok(!html.includes(leak), `Resource-HTML statisch, kein ${leak}`);
    }
  });
});

test("T-P4-UI-AC5: Callback = authentisierter cancel_call-Tool-Call auf den gegateten /cancel-Pfad", async () => {
  await withGatewayCapture(RICH_CALL, async (mock) => {
    const { tools } = captureUi({ identity: "user@example.com", uiHost: capableHost() });
    await tools.get("cancel_call").handler({ call_id: "call_1" });

    assert.equal(mock.requests.length, 1, "genau ein Gateway-Request");
    const req = mock.requests[0];
    assert.equal(req.method, "POST", "POST (Schreib-Aktion)");
    assert.equal(req.url, "/api/calls/call_1/cancel", "bestehender, gegateter Abbruch-Pfad");
    assert.equal(
      req.headers["x-internal-identity"],
      "user@example.com",
      "Identitaets-Header gesetzt -> serverseitig mcpAuth/requestTenant/tenantOwnsCall, kein Seitenkanal",
    );
  });
});

test("T-P4-UI-AC6: call-result.html self-contained + zielt auf das gegatete cancel_call", async () => {
  const readback = await new Promise((resolve) => {
    const fakeServer = {
      registerResource(_name, _uri, _config, readCallback) {
        resolve(readCallback());
      },
    };
    mcpNativeRenderer.registerResource(fakeServer, WIDGET_CALL_RESULT);
  });
  const content = readback.contents[0];
  assert.equal(content.mimeType, UI_MIME);
  const html = content.text;
  assert.ok(html.startsWith("<!-- @dsCard"), "@dsCard-Marker in Zeile 1");
  assert.ok(!html.includes("@import"), "kein @import");
  assert.doesNotMatch(html, /<link[\s>]/, "kein <link>-Element");
  assert.doesNotMatch(html, /href\s*=/, "kein href-Linkback");
  // Widget zielt auf das gegatete Tool (kein Seitenkanal) und kennt die call_id-Quelle.
  assert.ok(html.includes("cancel_call"), "Widget ruft cancel_call");
  assert.ok(html.includes('data-mcp="call_id"'), "Widget liest call_id aus structuredContent");
  assert.equal(mcpNativeRenderer.hasWidget(WIDGET_CALL_RESULT), true, "Adapter kennt call-result");
});

// ===== W3: drittes read-only Widget (get_agent_status) ueber den BESTEHENDEN Seam =====
// Stufe 0 (structuredContent + Backward-Compat-Text) + Stufe 1 (agent-status Widget) bei
// faehigem Host; Fallback Stufe-0 bei unfaehigem. Whitelist beweist Nicht-Durchreichung
// von PII/Secrets/Cross-Tenant-State. Read-only: kein Callback/Button. Erbt W1-Binding.
const RICH_STATE = {
  agent: {
    number: "+18643028341",
    owner: "Antonio",
    voiceEngine: "budget",
    model: "claude-haiku",
    allowedNumbers: ["+4917212345678"],
    secretAgentField: "agent-LEAK", // darf NIE durch
  },
  usage: { calls: 3, costEur: 2.1, maxBudgetEur: 10, internalCounter: 999 },
  settings: {
    allowCalendar: true,
    allowBooking: false,
    allowSummaries: true,
    allowPersonalData: false,
    allowBankData: false,
    secretSetting: "settings-LEAK",
  },
  // Felder, die NIEMALS nach aussen duerfen:
  email: "secret@example.com",
  apiKey: "sk_live_LEAK",
  tenantId: "tenant-XYZ",
  calls: [{ id: "c1", from: "+49170000000" }], // fremder state, nicht durchreichen
};
const RESOURCE_URI_AGENT = uiResourceUri(WIDGET_AGENT_STATUS); // ui://hermes/agent-status
const AGENT_KEYS = [
  "allowedNumbers",
  "calls",
  "costEur",
  "maxBudgetEur",
  "model",
  "number",
  "owner",
  "permissions",
  "voiceEngine",
];
const PERMISSIONS_STR =
  "Kalender=true, Buchen=false, Summaries=true, PersoenlicheDaten=false, Bankdaten=false";
const agentStatusOutput = z.object({
  number: z.string().nullable(),
  owner: z.string().nullable(),
  voiceEngine: z.string(),
  model: z.string(),
  calls: z.number(),
  costEur: z.number(),
  maxBudgetEur: z.number(),
  allowedNumbers: z.array(z.string()),
  permissions: z.string(),
});

test("T-W3-AC1: Stufe 0 additiv - Backward-Compat-Text + schema-validiertes structuredContent", async () => {
  await withGateway(RICH_STATE, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { config, handler } = tools.get("get_agent_status");
    assert.ok(config.outputSchema, "outputSchema am config deklariert");
    const result = await handler({});

    assert.equal(result.content[0].type, "text", "Textblock bleibt erhalten");
    const txt = result.content[0].text;
    assert.match(txt, /Agent-Nummer:/, "Backward-Compat-Format (Agent-Nummer)");
    assert.match(txt, /Berechtigungen:/, "Backward-Compat-Format (Berechtigungen)");

    assert.ok(result.structuredContent, "structuredContent vorhanden");
    assert.deepEqual(Object.keys(result.structuredContent).sort(), AGENT_KEYS);
    assert.equal(result.structuredContent.permissions, PERMISSIONS_STR);
    assert.doesNotThrow(
      () => agentStatusOutput.parse(result.structuredContent),
      "structuredContent validiert gegen outputSchema",
    );
  });
});

test("T-W3-AC2: Stufe 1 (faehiger Host) - genau eine agent-status-Resource + _meta zeigt darauf", async () => {
  await withGateway(RICH_STATE, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const agentResources = resources.filter((r) => r.uri === RESOURCE_URI_AGENT);
    assert.equal(agentResources.length, 1, "genau eine agent-status-Resource");
    assert.equal(agentResources[0].config.mimeType, UI_MIME);

    const { config } = tools.get("get_agent_status");
    assert.equal(config._meta.ui.resourceUri, RESOURCE_URI_AGENT, "_meta zeigt auf dieselbe URI");
  });
});

test("T-W3-AC3: Fallback fail-closed - kein _meta, keine agent-status-Resource, Tool bleibt", async () => {
  const cases = {
    "stdio (uiHost=null)": null,
    "enabled aber Capability fehlt": { enabled: true, capabilities: {} },
    "Master-Schalter aus trotz Capability": { enabled: false, capabilities: CAPABLE_CAPS },
    "unbekannter Host (fremder mimeType)": {
      enabled: true,
      capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html"] } } },
    },
  };
  await withGateway(RICH_STATE, async () => {
    for (const [label, uiHost] of Object.entries(cases)) {
      const { tools, resources } = captureUi(uiHost === null ? undefined : { uiHost });
      const { config, handler } = tools.get("get_agent_status");
      assert.equal(
        resources.filter((r) => r.uri === RESOURCE_URI_AGENT).length,
        0,
        `${label}: keine agent-status-Resource`,
      );
      assert.ok(!config._meta, `${label}: kein _meta`);
      // Default-Tool: existiert in ALLEN Faellen, nur das Widget faellt weg.
      const result = await handler({});
      assert.ok(result.structuredContent, `${label}: structuredContent bleibt`);
      assert.deepEqual(Object.keys(result.structuredContent).sort(), AGENT_KEYS);
    }
  });
});

test("T-W3-AC4: Whitelist - keine fremden/PII-Felder in structuredContent/Text/Resource", async () => {
  await withGateway(RICH_STATE, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_agent_status");
    const result = await handler({});

    const serialized = JSON.stringify(result);
    for (const leak of [
      "secret@example.com",
      "sk_live_LEAK",
      "tenant-XYZ",
      "agent-LEAK",
      "settings-LEAK",
      "c1",
    ]) {
      assert.ok(!serialized.includes(leak), `kein Leck von ${leak} im Tool-Result`);
    }
    assert.deepEqual(Object.keys(result.structuredContent).sort(), AGENT_KEYS);

    // Resource-HTML ist statisch -> enthaelt per Konstruktion keine Agent-Daten.
    const agentRes = resources.find((r) => r.uri === RESOURCE_URI_AGENT);
    const html = (await agentRes.readCallback()).contents[0].text;
    for (const leak of ["secret@example.com", "sk_live_LEAK", "tenant-XYZ", "agent-LEAK", "settings-LEAK"]) {
      assert.ok(!html.includes(leak), `Resource-HTML statisch, kein ${leak}`);
    }
  });
});

test("T-W3-AC5: Fehlerpfad - Body ohne agent -> isError, text-only, auch bei faehigem Host", async () => {
  // Body ohne agent -> requireFields wirft VOR pickAgentStatus -> wrapHandler isError.
  await withGateway({ usage: {}, settings: {} }, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_agent_status");
    const result = await handler({});
    assert.ok(result.isError, "degradierte Antwort -> isError");
    assert.ok(!result.structuredContent, "Fehlerpfad ohne structuredContent");
    const txt = result.content.map((c) => c.text).join("\n");
    assert.doesNotMatch(txt, /Cannot read|undefined|TypeError/i, "generischer, provider-freier Text");
  });
});

test("T-W3-AC6: agent-status.html self-contained + read-only + erbt W1-Binding", async () => {
  const readback = await readbackResource(mcpNativeRenderer, WIDGET_AGENT_STATUS);
  const content = readback.contents[0];
  assert.equal(content.mimeType, UI_MIME);
  const html = content.text;
  assert.ok(html.startsWith("<!-- @dsCard"), "@dsCard-Marker in Zeile 1");
  assert.ok(!html.includes("@import"), "kein @import");
  assert.doesNotMatch(html, /<link[\s>]/, "kein <link>-Element");
  assert.doesNotMatch(html, /href\s*=/, "kein href-Linkback");
  // Read-only: kein Callback/Button/Tool-Trigger im Widget (W3).
  assert.doesNotMatch(html, /<button/, "kein <button> (read-only)");
  assert.ok(!html.includes("callTool"), "kein callTool (read-only, kein Callback)");
  // Erbt W1-Binding: die injizierte Bootstrap-Quelle (run(window)) ist vorhanden.
  assert.ok(html.includes("run(window)"), "injiziertes W1-Binding (run(window)) vorhanden");
  assert.equal(mcpNativeRenderer.hasWidget(WIDGET_AGENT_STATUS), true, "Adapter kennt agent-status");
});
