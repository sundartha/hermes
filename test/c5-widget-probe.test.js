// C5 Widget-Host-Capability-Spike: das Wegwerf-Probe-Tool/-Widget (probe_call_bridge)
// ist hinter MCP_UI_PROBE gegated (genested unter MCP_UI_ENABLED). Diese Tests pinnen
// das deterministische SERVER-Verhalten (Gating, Whitelist-Wiederverwendung, Widget-
// Selbsttragung). Die eigentliche Host-Bruecken-Capability ist nur am echten Claude-
// Host beobachtbar -> dokumentierter Live-Smoke (kein realer MCP-Apps-Host im Test).
// Kein echter MCP-Transport: ein fakeServer faengt registerTool/registerResource, ein
// lokaler HTTP-Mock spielt das Gateway (Muster aus mcp-ui.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { z } from "zod";
import { registerTools } from "../src/mcp-tools.js";
import { UI_MIME, uiResourceUri } from "../src/ui/contract.js";
import { widgetHtml, WIDGET_PROBE } from "../src/ui/widget-catalog.js";
import { BIND_SCRIPT } from "../src/ui/widget-bind.js";

const PROBE_TOOL = "probe_call_bridge";
const PROBE_URI = uiResourceUri(WIDGET_PROBE); // ui://hermes/probe-call-bridge

// Faehiger Host: deklariert die UI-Capability mit UI_MIME (SEP-1865 initialize).
const CAPABLE_CAPS = {
  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [UI_MIME] } },
};
const capableHost = () => ({ enabled: true, capabilities: CAPABLE_CAPS });

// Faengt registerTool(name, config, handler) + registerResource(name, uri, config,
// readCb) ein (wie mcp-ui.test.js). tool() (Bestand) ueber server.tool.
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

// Gateway-Mock mit konfigurierbarem Body. RICH_CALL traegt PII-Zusatzfelder, die NIE
// nach aussen duerfen (Whitelist-Beweis, identisch zum get_call_status-Test).
const RICH_CALL = {
  status: "active",
  answeredAt: "2026-06-26T10:00:00.000Z",
  startedAt: "2026-06-26T09:59:50.000Z",
  transcript: [
    { role: "agent", text: "Guten Tag, hier ist Hermes.", at: "2026-06-26T10:00:01.000Z" },
    { role: "callee", text: "Hallo, worum geht es?", at: "2026-06-26T10:00:05.000Z" },
  ],
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

const PROBE_KEYS = ["call_id", "duration_s", "last_transcript_lines", "status"];
const callStatusOutput = z.object({
  call_id: z.string(),
  status: z.string(),
  duration_s: z.number(),
  last_transcript_lines: z.array(z.string()),
});

test("T-C5-1: Default (kein uiProbe) -> Probe-Tool/-Resource erscheinen NICHT (byte-identisch)", () => {
  const { tools, resources } = captureUi({ uiHost: capableHost() });
  assert.equal(tools.has(PROBE_TOOL), false, "ohne uiProbe kein probe_call_bridge in der Tool-Liste");
  assert.equal(
    resources.filter((r) => r.uri === PROBE_URI).length,
    0,
    "ohne uiProbe keine probe-call-bridge-Resource",
  );
  // Bestands-Tools bleiben unberuehrt verfuegbar.
  assert.equal(tools.has("get_call_status"), true, "get_call_status bleibt");
});

test("T-C5-2: Probe AN + faehiger Host -> genau eine Resource + _meta + outputSchema", () => {
  const { tools, resources } = captureUi({ uiHost: capableHost(), uiProbe: true });
  assert.equal(tools.has(PROBE_TOOL), true, "probe_call_bridge registriert");

  const probeResources = resources.filter((r) => r.uri === PROBE_URI);
  assert.equal(probeResources.length, 1, "genau eine probe-call-bridge-Resource");
  assert.equal(probeResources[0].config.mimeType, UI_MIME);

  const { config } = tools.get(PROBE_TOOL);
  assert.equal(config._meta.ui.resourceUri, PROBE_URI, "_meta zeigt auf dieselbe URI");
  assert.ok(config.outputSchema, "outputSchema am config deklariert");
  assert.deepEqual(Object.keys(config.outputSchema).sort(), PROBE_KEYS, "outputSchema = CALL_STATUS_OUTPUT-Form");
});

test("T-C5-3: Master-Schalter aus dominiert -> Probe-Flag bleibt fail-closed (kein Tool/Resource)", () => {
  // uiProbe an, aber kein faehiger Renderer (uiRenderer null): der Tool-Guard prueft
  // eigenstaendig uiRenderer && hasWidget -> nichts angeboten. Auch stdio (kein hostHint).
  const cases = {
    "Master-Schalter aus trotz uiProbe": { uiHost: { enabled: false }, uiProbe: true },
    "stdio (kein uiHost) trotz uiProbe": { uiProbe: true },
  };
  for (const [label, ctx] of Object.entries(cases)) {
    const { tools, resources } = captureUi(ctx);
    assert.equal(tools.has(PROBE_TOOL), false, `${label}: kein Probe-Tool`);
    assert.equal(
      resources.filter((r) => r.uri === PROBE_URI).length,
      0,
      `${label}: keine Probe-Resource`,
    );
  }
});

test("T-C5-4: Whitelist (Regel 5) - Probe reused callStatusResult, keine neue Datenflaeche", async () => {
  await withGateway(RICH_CALL, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost(), uiProbe: true });
    const { handler } = tools.get(PROBE_TOOL);
    const result = await handler({ call_id: "call_1" });

    assert.deepEqual(Object.keys(result.structuredContent).sort(), PROBE_KEYS, "exakt der get_call_status-Kontrakt");
    assert.equal(result.structuredContent.call_id, "call_1");
    assert.equal(result.structuredContent.status, "in_progress");
    assert.doesNotThrow(
      () => callStatusOutput.parse(result.structuredContent),
      "structuredContent validiert gegen die get_call_status-Whitelist",
    );

    const serialized = JSON.stringify(result);
    for (const leak of ["secret@example.com", "sk_live_LEAK", "tenant-XYZ", "recording.wav"]) {
      assert.ok(!serialized.includes(leak), `kein Leck von ${leak} im Probe-Result`);
    }

    // Resource-HTML ist statisch -> per Konstruktion keine Call-Daten.
    const probeRes = resources.find((r) => r.uri === PROBE_URI);
    const html = (await probeRes.readCallback()).contents[0].text;
    for (const leak of ["secret@example.com", "sk_live_LEAK", "tenant-XYZ", "recording.wav"]) {
      assert.ok(!html.includes(leak), `Resource-HTML statisch, kein ${leak}`);
    }
  });
});

test("T-C5-5: probe-call-bridge.html self-contained - eine BIND_SCRIPT-Quelle, kein @import/innerHTML/href", () => {
  const html = widgetHtml(WIDGET_PROBE);
  assert.equal(html.split(BIND_SCRIPT).length, 2, "BIND_SCRIPT genau einmal injiziert");
  assert.ok(html.lastIndexOf(BIND_SCRIPT) < html.lastIndexOf("</body>"), "BIND_SCRIPT vor </body>");
  assert.ok(!html.includes("@import"), "kein @import (Iframe-Sandbox)");
  assert.ok(!html.includes("innerHTML"), "kein innerHTML (XSS-Gate, S1)");
  assert.doesNotMatch(html, /<link[\s>]/, "kein <link>-Element");
  assert.doesNotMatch(html, /href\s*=/, "kein href-Linkback");
});

test("T-C5-6: config.mcpUiProbe - Default false; MCP_UI_PROBE=true -> true", async () => {
  // Query-String-Import = frische Modul-Instanz (entkoppelt von der Import-Reihenfolge).
  // NODE_ENV=test ueberspringt dotenv -> config liest ausschliesslich process.env.
  const prev = process.env.MCP_UI_PROBE;
  try {
    delete process.env.MCP_UI_PROBE;
    const { config: cDefault } = await import("../src/config.js?c5=default");
    assert.equal(cDefault.mcpUiProbe, false, "Default fail-closed AUS");

    process.env.MCP_UI_PROBE = "true";
    const { config: cOn } = await import("../src/config.js?c5=on");
    assert.equal(cOn.mcpUiProbe, true, "MCP_UI_PROBE=true -> true");
  } finally {
    if (prev === undefined) delete process.env.MCP_UI_PROBE;
    else process.env.MCP_UI_PROBE = prev;
  }
});
