// i18n-Launch-Testkatalog, Block B3 (MCP-Schicht und Widgets).
// Katalog-IDs in dieser Datei: MCP-05. Spezifikation:
// tasks/i18n-tests/04-mcp-und-widgets.md (MCP-04..MCP-12). Polaritaet je Test steht im
// Kopfkommentar des jeweiligen Testfalls.
//
// P12 (MCP-Textkanal, PLAN-I18N-FIX): PROMPT-09, FMT-03, MCP-04, MCP-06, MCP-08 wurden
// gefixt und leben jetzt (A3-Umzug) als T1-T6 in test/mcp-tools-language.test.js. MCP-05
// war bereits gruen und bleibt hier stehen (unveraendert). MCP-09/MCP-12 (P13, Widget und
// Kanarienvogel) sind gefixt und als T11/T12 (ex MCP-09/MCP-12) nach
// test/mcp-tools-language.test.js umgezogen (A3).
//
// Harness-Muster (kopiert/angepasst aus test/mcp-tools.test.js + test/mcp-ui.test.js -
// beide Dateien gehoeren NICHT zu diesem Block und werden nicht editiert).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools } from "../src/mcp-tools.js";

// ---- geteilter Mini-Harness (Muster test/mcp-tools.test.js) ----

function captureTools(ctx) {
  const handlers = new Map();
  const fakeServer = {
    tool(name, _desc, _schema, handler) {
      handlers.set(name, handler);
    },
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return handlers;
}

async function listen(server) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((r) => server.close(r)) };
}

function sendJson(res, { body = null, status = 200 } = {}) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(body == null ? "" : JSON.stringify(body));
}

async function startGatewayMock({ body = null, status = 200 } = {}) {
  const server = http.createServer((req, res) => sendJson(res, { body, status }));
  return listen(server);
}

async function withGateway(body, fn) {
  const mock = await startGatewayMock({ body });
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

function toolText(result) {
  return (result?.content || []).map((c) => c.text).join("\n");
}

// ==================== MCP-05 ====================
// wrapHandler-Catch-Fallback bei Netzwerkfehler ist fest Deutsch (SOLL, P0).
// Beleg: src/mcp-tools.js (wrapHandler).
//
// MESSUNG WEICHT VON DER KATALOG-ANNAHME AB (siehe Report/meldungen): der Katalog geht
// davon aus, dass ein ECONNREFUSED den deutschen Fallback ("... nicht erreichbar ...")
// auslaest, weil err?.message dann leer sei. Empirisch (dieser Node/undici-Stand) wirft
// fetch() bei einem nicht erreichbaren Host ein TypeError mit err.message === "fetch
// failed" - NIE leer. err?.message || FALLBACK greift damit nie den deutschen String,
// sondern reicht "fetch failed" (englisch, aber ein roher technischer String) durch. Der
// Test bleibt an der spezifizierten SOLL-Assertion (kein deutscher Fallback-Text fuer den
// EN-Tenant) - diese Assertion ist nach der Messung GRUEN, nicht rot wie im Katalog
// vorhergesagt (Polaritaets-Abweichung, siehe Report).
test("MCP-05: wrapHandler-Fallback bei Netzwerkfehler zeigt einem EN-Tenant keinen deutschen Text", async () => {
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = "http://127.0.0.1:1"; // kein lauschender Server -> ECONNREFUSED
  try {
    const handlers = captureTools({ identity: null, scopedTenant: "tenant-en-us" });
    const result = await handlers.get("get_my_number")();
    assert.ok(result?.isError, "Netzwerkfehler -> isError-Tool-Antwort");
    assert.doesNotMatch(
      toolText(result),
      /nicht erreichbar/,
      "EN-Tenant darf keinen deutschen Fallback-Text sehen",
    );
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
  }
});
