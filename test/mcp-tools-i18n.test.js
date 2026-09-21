// i18n-Launch-Testkatalog, Block B3 (MCP-Schicht und Widgets).
// Katalog-IDs in dieser Datei: MCP-05, MCP-14, MCP-16. Spezifikation:
// tasks/i18n-tests/04-mcp-und-widgets.md (MCP-04..MCP-12). Polaritaet je Test steht im
// Kopfkommentar des jeweiligen Testfalls.
//
// P12 (MCP-Textkanal, PLAN-I18N-FIX): PROMPT-09, FMT-03, MCP-04, MCP-06, MCP-08 wurden
// gefixt und leben jetzt (A3-Umzug) als T1-T6 in test/mcp-tools-language.test.js. MCP-05
// war bereits gruen und bleibt hier stehen (unveraendert). MCP-09/MCP-12 (P13, Widget und
// Kanarienvogel) sind gefixt und als T11/T12 (ex MCP-09/MCP-12) nach
// test/mcp-tools-language.test.js umgezogen (A3).
//
// MCP-14 (R-G: neues Subjekt) - das Katalog-Subjekt ist tot, ein besseres lebt. Der
// Katalog misst "Gegenseite" in get_call_status - seit P12 geschlossen
// (pickCallStatus -> texts.roleCounterparty, gepinnt in mcp-tools-language.test.js).
// Ein gruener Pin darauf waere ein Duplikat. Gemessen sind stattdessen drei ECHTE
// deutsche Stufe-0-Artefakte in src/mcp-tools.js (alle sprachfrei, kein loc.-Bezug):
// der Leertext von list_action_items, dessen Termin-Praefix, und der Verbinder
// " bis " in get_calendar. MCP-14 wird gegen diese gebaut (GERMAN_STAGE0_PROBES unten).
// Die Katalog-These ("ein Widget-Fix reicht nicht") bleibt woertlich erhalten und wird
// als zweiter, gruener Test bewiesen: get_calendar traegt ein Widget, sein Text ist
// trotzdem host-unabhaengig.
//
// MCP-14 widerspricht einem Bestandspin (test/mcp-tools.test.js S1-5b:
// assert.equal(toolText(result), "Keine offenen Action Items.") bleibt dort gruen).
// Muster GAP-37 (W2-B6): der Widerspruch IST der Launch-Befund - der Bestandstest
// bleibt namens-neutral gruen im Regressionslauf, MCP-14a faehrt ID-getragen rot im
// Gate-Lauf. Fix-Auflage (Report): nach dem Fix (loc.mcp.emptyActionItems /
// appointmentPrefix / calendarRangeSeparator) muss der Bestandspin mitgezogen werden.
//
// Harness-Muster (kopiert/angepasst aus test/mcp-tools.test.js + test/mcp-ui.test.js -
// beide Dateien gehoeren NICHT zu diesem Block und werden nicht editiert).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools } from "../src/mcp-tools.js";
import { startServer, startIdp, mcpPost, toolCall, readToolResult } from "./helpers.js";
import { makeDefaultState, registerTenant, settingsFor } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

// ---- geteilter Mini-Harness (Muster test/mcp-tools.test.js) ----

const HTTP_OK = 200;

// Einziger Registrierweg ist registerTool (src/mcp-tools.js uiTool); ein
// server.tool()-Aufruf wuerde hier absichtlich mit TypeError scheitern.
function captureTools(ctx) {
  const handlers = new Map();
  const fakeServer = {
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return handlers;
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((resolve) => server.close(resolve)) };
}

function sendJson(res, { body = null, status = HTTP_OK } = {}) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body == null ? "" : JSON.stringify(body));
}

async function startGatewayMock({ body = null, status = HTTP_OK } = {}) {
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
  return (result?.content || []).map((item) => item.text).join("\n");
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

// ==================== MCP-14 ====================
const EN_TENANT = "tenant-en-us";
const CALENDAR_FIXTURE = {
  calendar: [{ title: "Dentist", start: "2026-07-01T09:00:00.000Z", end: "2026-07-01T09:30:00.000Z" }],
};
const APPOINTMENT_ITEM = { actionItems: [{ id: "ai_1", text: "Call back", type: "appointment", done: false }] };
const NO_ITEMS = { actionItems: [] };
// Die drei heute noch sprachfrei-deutschen Stufe-0-Artefakte in src/mcp-tools.js.
const GERMAN_STAGE0_PROBES = [
  { label: "get_calendar-Verbinder", tool: "get_calendar", body: CALENDAR_FIXTURE, german: / bis / },
  { label: "list_action_items-Praefix", tool: "list_action_items", body: APPOINTMENT_ITEM, german: /\(Termin\)/ },
  { label: "list_action_items-Leertext", tool: "list_action_items", body: NO_ITEMS, german: /Keine offenen Action Items/ },
];
const CAPABLE_UI_HOST = { enabled: true }; // ohne chatgpt-mimeType -> mcpNativeRenderer (ui/registry.js)

test("MCP-14 (SOLL, rot) - Stufe-0-Text eines EN-Tenants traegt keine deutschen Artefakte, auch bei faehigem Host", async () => {
  for (const probe of GERMAN_STAGE0_PROBES) {
    await withGateway(probe.body, async () => {
      const handlers = captureTools({ scopedTenant: EN_TENANT, language: "en", uiHost: CAPABLE_UI_HOST });
      // doesNotMatch statt equal ist Absicht: ein Byte-Pin mit language:"en" im Ist-
      // Operanden und deutschem Erwartungswert waere genau der Mischsprach-Pin, den der
      // GAP-27-Waechter (test/helpers/characterization-scan.mjs) meldet.
      assert.doesNotMatch(toolText(await handlers.get(probe.tool)()), probe.german, probe.label);
    });
  }
});

test("MCP-14 (Mechanismus, gruen) - der Stufe-0-Text ist host-unabhaengig: ein reiner Widget-Fix aendert ihn nicht", async () => {
  await withGateway(CALENDAR_FIXTURE, async () => {
    const withoutHost = toolText(
      await captureTools({ scopedTenant: EN_TENANT, language: "en" }).get("get_calendar")(),
    );
    const withWidgetHost = toolText(
      await captureTools({ scopedTenant: EN_TENANT, language: "en", uiHost: CAPABLE_UI_HOST }).get("get_calendar")(),
    );
    assert.equal(
      withoutHost,
      withWidgetHost,
      "get_calendar traegt ein Widget - sein Text haengt trotzdem nicht am Host",
    );
  });
});

// ==================== MCP-16 ====================
const MCP_TENANT_DE = { id: "t_mcp_de", sub: "sub-mcp-de", language: "de", e164: "+4915100000201" };
const MCP_TENANT_EN = { id: "t_mcp_en", sub: "sub-mcp-en", language: "en", e164: "+12025550201" };

// Owner-Nummer (Boot-Guard) + zwei per idpSubject gebundene Tenants mit eigener DID -
// Muster e2e-02-two-tenant-two-language.test.js (twoTenantSeed) + am6-oauth-tenant.test.js
// (idpSubject-Bindung), hier fuer den MCP-OAuth-Pfad kombiniert.
function twoLanguageTenantSeed() {
  const state = makeDefaultState();
  state.numbers.push({
    id: "num_owner_mcp16",
    e164: "+4915199999998",
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: "telnyx",
    status: "active",
    providerNumberId: null,
  });
  for (const tenant of [MCP_TENANT_DE, MCP_TENANT_EN]) {
    registerTenant(state, tenant.id, { idpSubject: tenant.sub });
    settingsFor(state, tenant.id).language = tenant.language;
    state.numbers.push({
      id: `num_${tenant.id}`,
      e164: tenant.e164,
      tenantId: tenant.id,
      provider: "telnyx",
      status: "active",
      providerNumberId: null,
    });
  }
  return state;
}

test("MCP-16 (Mechanismus, gruen) - parallele /mcp-Requests zweier Tenants leaken keine Sprache", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, MULTI_TENANT: "true" },
    seed: twoLanguageTenantSeed(),
  });
  try {
    const [tokenDe, tokenEn] = await Promise.all([
      idp.sign({ sub: MCP_TENANT_DE.sub }),
      idp.sign({ sub: MCP_TENANT_EN.sub }),
    ]);
    const [resDe, resEn] = await Promise.all([
      mcpPost(`${srv.localUrl}/mcp`, tokenDe, toolCall("list_calls")),
      mcpPost(`${srv.localUrl}/mcp`, tokenEn, toolCall("list_calls")),
    ]);
    const textDe = (await readToolResult(resDe)).content[0].text;
    const textEn = (await readToolResult(resEn)).content[0].text;
    assert.match(textDe, /Noch keine Anrufe/);
    assert.match(textEn, /No calls yet/);
    assert.doesNotMatch(textEn, /Noch keine Anrufe/, "kein Sprach-Leak vom parallelen DE-Request");
  } finally {
    await srv.stop();
    await idp.close();
  }
});
