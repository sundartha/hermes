// i18n-Launch-Testkatalog, Block B3 (MCP-Schicht und Widgets).
// Katalog-IDs in dieser Datei: MCP-05, MCP-09, MCP-12. Spezifikation:
// tasks/i18n-tests/04-mcp-und-widgets.md (MCP-04..MCP-12). Polaritaet je Test steht im
// Kopfkommentar des jeweiligen Testfalls.
//
// P12 (MCP-Textkanal, PLAN-I18N-FIX): PROMPT-09, FMT-03, MCP-04, MCP-06, MCP-08 wurden
// gefixt und leben jetzt (A3-Umzug) als T1-T6 in test/mcp-tools-language.test.js. MCP-05
// war bereits gruen und bleibt hier stehen (unveraendert). MCP-09/MCP-12 gehoeren zum
// Widget-Strang P13 und bleiben rot - das ist der Befund, nicht ein Fehler dieser Datei.
//
// Harness-Muster (kopiert/angepasst aus test/mcp-tools.test.js + test/mcp-ui.test.js -
// beide Dateien gehoeren NICHT zu diesem Block und werden nicht editiert).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerTools } from "../src/mcp-tools.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

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

// ==================== MCP-09 ====================
// permissionsSummary() liefert deutsche Feldnamen, byte-gepinnt als Sollzustand (SOLL, P0).
// Beleg: src/mcp-tools.js (permissionsSummary); test/mcp-ui.test.js:682
// (bestehender, GRUENER Pin auf denselben deutschen String - NICHT Teil dieses Blocks,
// bleibt unangetastet; ein spaeterer Fix muss ihn explizit mit anpassen, siehe Katalog).
const AGENT_STATE_FIXTURE = {
  agent: { number: "+18643028341", owner: "Antonio", voiceEngine: "budget", model: "claude-haiku" },
  usage: {
    calls: 3,
    costEur: 2.1,
    tenantCapEur: 10,
    spendMonthCostEur: 0.6,
    spendMonthKey: "2026-07",
    reservedEur: 0.6,
  },
  settings: { allowSummaries: true, allowPersonalData: false, allowBankData: false },
};
test("MCP-09: structuredContent.permissions traegt fuer einen EN-Tenant keine deutschen Feldnamen", async () => {
  await withGateway(AGENT_STATE_FIXTURE, async () => {
    const handlers = captureTools({ identity: null, scopedTenant: "tenant-en-us" });
    const result = await handlers.get("get_agent_status")();
    assert.doesNotMatch(
      result.structuredContent.permissions,
      /PersoenlicheDaten|Bankdaten/,
      "EN-Tenant darf keine deutschen Berechtigungs-Feldnamen sehen",
    );
  });
});

// ==================== MCP-12 ====================
// Kanarien-Test: keine bestehende Testdatei prueft ein EN-/US-Szenario der MCP-Schicht
// (SOLL, P0, als Gate gedacht - bewusst so konstruiert, dass er erst gruen wird, sobald
// echte EN-Testfaelle in den dort GENANNTEN Bestandsdateien existieren; diese Datei zaehlt
// nicht mit, weil der Katalog explizit die drei folgenden Bestandsdateien benennt).
// Beleg: test/mcp-tools.test.js, test/mcp-ui.test.js, test/mcp-ui-widget-i18n.test.js
// (alle drei NICHT Teil dieses Blocks - nur gelesen, nicht editiert).
test("MCP-12: Bestandstests (mcp-tools/mcp-ui/mcp-ui-widget-i18n) enthalten mindestens einen EN-Sprachfall", () => {
  const files = ["mcp-tools.test.js", "mcp-ui.test.js", "mcp-ui-widget-i18n.test.js"];
  let hits = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, "test", f), "utf8");
    hits += (src.match(/language\s*[:=]\s*["']en/g) || []).length;
  }
  assert.ok(
    hits > 0,
    "kein bestehender Bestandstest deckt heute ein EN-/US-Sprachszenario der MCP-Schicht ab",
  );
});
