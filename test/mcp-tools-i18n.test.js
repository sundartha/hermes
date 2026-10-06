import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools } from "../src/mcp-tools.js";
import { startServer, startIdp, mcpPost, toolCall, readToolResult } from "./helpers.js";
import { makeDefaultState, registerTenant, settingsFor } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const HTTP_OK = 200;

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

test("MCP-05: wrapHandler-Fallback bei Netzwerkfehler zeigt einem EN-Tenant keinen deutschen Text", async () => {
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = "http://127.0.0.1:1";
  try {
    const handlers = captureTools({ identity: null, scopedTenant: "tenant-en-us", language: "en" });
    const result = await handlers.get("get_agent_number")();
    assert.ok(result?.isError, "Netzwerkfehler -> isError-Tool-Antwort");
    assert.doesNotMatch(
      toolText(result),
      /nicht erreichbar/,
      "EN-Tenant darf keinen deutschen Fallback-Text sehen",
    );
    assert.doesNotMatch(toolText(result), /fetch failed/, "kein roher Netzwerkfehler-Text (O-13)");
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
  }
});

const EN_TENANT = "tenant-en-us";
const CALLS_FIXTURE = {
  calls: [{ id: "call_1", direction: "inbound", counterparty: "+491234", status: "completed", startedAt: "2026-07-01T09:00:00.000Z" }],
};
const APPOINTMENT_ITEM = { actionItems: [{ id: "ai_1", text: "Call back", type: "appointment", done: false }] };
const NO_ITEMS = { actionItems: [] };
const GERMAN_STAGE0_PROBES = [
  { label: "list_action_items-Praefix", tool: "list_action_items", body: APPOINTMENT_ITEM, german: /\(Termin\)/ },
  { label: "list_action_items-Leertext", tool: "list_action_items", body: NO_ITEMS, german: /Keine offenen Action Items/ },
];
const CAPABLE_UI_HOST = { enabled: true };

test("MCP-14 (SOLL, rot) - Stufe-0-Text eines EN-Tenants traegt keine deutschen Artefakte, auch bei faehigem Host", async () => {
  for (const probe of GERMAN_STAGE0_PROBES) {
    await withGateway(probe.body, async () => {
      const handlers = captureTools({ scopedTenant: EN_TENANT, language: "en", uiHost: CAPABLE_UI_HOST });
      assert.doesNotMatch(toolText(await handlers.get(probe.tool)()), probe.german, probe.label);
    });
  }
});

test("MCP-14 (Mechanismus, gruen) - der Stufe-0-Text ist host-unabhaengig: ein reiner Widget-Fix aendert ihn nicht", async () => {
  await withGateway(CALLS_FIXTURE, async () => {
    const withoutHost = toolText(
      await captureTools({ scopedTenant: EN_TENANT, language: "en" }).get("list_calls")(),
    );
    const withWidgetHost = toolText(
      await captureTools({ scopedTenant: EN_TENANT, language: "en", uiHost: CAPABLE_UI_HOST }).get("list_calls")(),
    );
    assert.equal(
      withoutHost,
      withWidgetHost,
      "list_calls traegt ein Widget - sein Text haengt trotzdem nicht am Host",
    );
  });
});

const MCP_TENANT_DE = { id: "t_mcp_de", sub: "sub-mcp-de", language: "de", e164: "+4915100000201" };
const MCP_TENANT_EN = { id: "t_mcp_en", sub: "sub-mcp-en", language: "en", e164: "+12025550201" };

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
