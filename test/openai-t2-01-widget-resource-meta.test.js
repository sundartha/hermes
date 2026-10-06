import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  startServer,
  startIdp,
  mcpPost,
  readToolResult,
  toolCall,
  ROOT,
  BASE_ENV,
  externalIp,
  quelltexteUnter,
} from "./helpers.js";
import { makeDefaultState, registerTenant, settingsFor } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { widgetHtml } from "../src/ui/widget-catalog.js";
import { WIDGET_LOCALE_META_KEY } from "../src/ui/widget-i18n.js";

const WIDGET_COUNT = 4;
const WIDGET_TOOL_COUNT = 5;
const HTTP_OK = 200;
const MCP_SERVER_ENTRYPOINT = "src/mcp-server.js";
const EXTERNAL_IP = externalIp();
const PROBE_ORIGIN = "https://probe.example";
const EXPECTED_META = {
  ui: { csp: { connectDomains: [], resourceDomains: [] } },
  "openai/widgetDomain": PROBE_ORIGIN,
};
const ANY = z.object({}).passthrough();
const SKYBRIDGE_CAPS_IN_REQUEST = {
  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html+skybridge"] } },
};

async function httpToolsList(baseUrl, token, params) {
  const body = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  if (params) body.params = params;
  const res = await mcpPost(`${baseUrl}/mcp`, token, body);
  return { status: res.status, tools: (await readToolResult(res)).tools };
}

async function httpResourcesList(baseUrl, token) {
  const res = await mcpPost(`${baseUrl}/mcp`, token, { jsonrpc: "2.0", id: 2, method: "resources/list" });
  return (await readToolResult(res)).resources;
}

async function httpResourceRead(baseUrl, token, uri) {
  const body = { jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri } };
  const res = await mcpPost(`${baseUrl}/mcp`, token, body);
  return await readToolResult(res);
}

async function httpWidgetLocale(baseUrl, token) {
  const res = await mcpPost(`${baseUrl}/mcp`, token, toolCall("get_agent_number"));
  const result = await readToolResult(res);
  return result._meta?.[WIDGET_LOCALE_META_KEY];
}

async function httpResourceReadFromIp(baseUrl, token, { uri, forwardedFor }) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      "X-Forwarded-For": forwardedFor,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri } }),
  });
  return await readToolResult(res);
}

async function httpResourceReadWithCapabilities(baseUrl, uri, capabilities) {
  const body = { jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri, capabilities } };
  const res = await mcpPost(`${baseUrl}/mcp`, null, body);
  return await readToolResult(res);
}

async function withStdioClient(env, run) {
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
  const client = new Client({ name: "t2-01-stdio-client", version: "0.0.0" }, { capabilities: {} });
  try {
    await client.connect(transport);
    await run(client, () => stderrOutput);
  } finally {
    await client.close();
  }
}

async function stdioToolsList(client, params) {
  const req = { method: "tools/list" };
  if (params) req.params = params;
  return (await client.request(req, ANY)).tools;
}

async function stdioResourcesList(client) {
  return (await client.request({ method: "resources/list" }, ANY)).resources;
}

async function stdioResourceRead(client, uri, params) {
  return await client.request({ method: "resources/read", params: { uri, ...(params || {}) } }, ANY);
}

const TENANT_DE = { id: "t_t201_de", sub: "sub-t201-de", language: "de", e164: "+4915100000301" };
const TENANT_EN = { id: "t_t201_en", sub: "sub-t201-en", language: "en", e164: "+12025550301" };

function twoTenantSeed() {
  const state = makeDefaultState();
  state.numbers.push({
    id: "num_owner_t201",
    e164: "+4915199999997",
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: "telnyx",
    status: "active",
    providerNumberId: null,
  });
  for (const tenant of [TENANT_DE, TENANT_EN]) {
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

function resourceText(reads, uri) {
  const read = reads[uri];
  const content = read.contents[0];
  return content.text;
}

function assertAllFiveResourcesCarryExpectedMeta(resources, reads) {
  assert.equal(resources.length, WIDGET_COUNT, "Positiv-Kontrolle: genau 4 Widgets");
  for (const resource of resources) {
    const read = reads[resource.uri];
    const content = read.contents[0];
    assert.deepEqual(content._meta, EXPECTED_META, `${resource.uri}: _meta = Sollwert`);
  }
}

test("T1 (HTTP OAuth): alle 5 Widget-Resources tragen den Sollwert, identisch ueber zwei Tenants verschiedener Sprache", async (ctx) => {
  if (!EXTERNAL_IP) return ctx.skip("keine externe Interface-IP");
  const idp = await startIdp();
  const srv = await startServer({
    seed: twoTenantSeed(),
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, MULTI_TENANT: "true", MCP_UI_ENABLED: "true", PUBLIC_URL: PROBE_ORIGIN },
  });
  try {
    const aud = `${PROBE_ORIGIN}/mcp`;
    const [tokenDe, tokenEn] = await Promise.all([
      idp.sign({ sub: TENANT_DE.sub }, { aud }),
      idp.sign({ sub: TENANT_EN.sub }, { aud }),
    ]);
    const readsByTenant = [];
    for (const token of [tokenDe, tokenEn]) {
      const resources = await httpResourcesList(srv.externalUrl, token);
      const reads = {};
      for (const resource of resources) reads[resource.uri] = await httpResourceRead(srv.externalUrl, token, resource.uri);
      assertAllFiveResourcesCarryExpectedMeta(resources, reads);
      readsByTenant.push(reads);
    }
    const [readsDe, readsEn] = readsByTenant;

    const [localeDe, localeEn] = await Promise.all([
      httpWidgetLocale(srv.externalUrl, tokenDe),
      httpWidgetLocale(srv.externalUrl, tokenEn),
    ]);
    assert.equal(localeDe, "de", "Positiv-Kontrolle: DE-Mandant meldet de");
    assert.equal(localeEn, "en", "Positiv-Kontrolle: EN-Mandant meldet en");

    for (const uri of Object.keys(readsDe)) {
      assert.equal(
        resourceText(readsDe, uri),
        resourceText(readsEn, uri),
        `${uri}: Resource-Text muss ueber DE- und EN-Mandant byte-gleich sein (T-34)`,
      );
    }
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("T2a (HTTP Token, Loopback mit korrektem Bearer): derselbe Beleg wie T1, auf dem Token-Pfad statt OAuth", async () => {
  const TEST_TOKEN = "t2-01-probe-token";
  const srv = await startServer({
    env: { MCP_AUTH: "token", MCP_AUTH_TOKEN: TEST_TOKEN, MCP_UI_ENABLED: "true", PUBLIC_URL: PROBE_ORIGIN },
  });
  try {
    const resources = await httpResourcesList(srv.localUrl, TEST_TOKEN);
    const reads = {};
    for (const resource of resources) reads[resource.uri] = await httpResourceRead(srv.localUrl, TEST_TOKEN, resource.uri);
    assertAllFiveResourcesCarryExpectedMeta(resources, reads);
  } finally {
    await srv.stop();
  }
});

test("T2b (HTTP Token, Interface-IP, Negativ-Beleg): korrekter Bearer OHNE Loopback bleibt 403 - kein Tenant, keine Widgets erreichbar", async (ctx) => {
  if (!EXTERNAL_IP) return ctx.skip("keine externe Interface-IP");
  const TEST_TOKEN = "t2-01-probe-token";
  const srv = await startServer({
    env: { MCP_AUTH: "token", MCP_AUTH_TOKEN: TEST_TOKEN, MCP_UI_ENABLED: "true", PUBLIC_URL: PROBE_ORIGIN },
  });
  try {
    const res = await mcpPost(`${srv.externalUrl}/mcp`, TEST_TOKEN, { jsonrpc: "2.0", id: 2, method: "resources/list" });
    assert.notEqual(res.status, HTTP_OK, "kein Tenant ueber die Interface-IP, trotz korrektem Bearer");
  } finally {
    await srv.stop();
  }
});

test("T2c (Legacy-Loopback, Bestand): kein Token noetig ueber localhost - deckt die umgebauten P8-C/P8-I ab", async () => {
  const srv = await startServer({ env: { MCP_UI_ENABLED: "true", PUBLIC_URL: PROBE_ORIGIN } });
  try {
    const resources = await httpResourcesList(srv.localUrl, null);
    const reads = {};
    for (const resource of resources) reads[resource.uri] = await httpResourceRead(srv.localUrl, null, resource.uri);
    assertAllFiveResourcesCarryExpectedMeta(resources, reads);
  } finally {
    await srv.stop();
  }
});

test("T3 (stdio): derselbe Beleg ueber den echten Kindprozess", async () => {
  await withStdioClient({ MCP_UI_ENABLED: "true", PUBLIC_URL: PROBE_ORIGIN }, async (client, stderr) => {
    const resources = await stdioResourcesList(client);
    assert.equal(resources.length, WIDGET_COUNT, `Positiv-Kontrolle (stderr: ${stderr()})`);
    for (const resource of resources) {
      const read = await stdioResourceRead(client, resource.uri);
      assert.deepEqual(read.contents[0]._meta, EXPECTED_META, `${resource.uri}: _meta = Sollwert (stdio)`);
    }
  });
});

test("T4 (stdio, fail-safe): ohne PUBLIC_URL/RENDER_EXTERNAL_URL fehlt openai/widgetDomain, csp bleibt Sollwert", async () => {
  await withStdioClient(
    { MCP_UI_ENABLED: "true", PUBLIC_URL: "", RENDER_EXTERNAL_URL: "" },
    async (client, stderr) => {
      const resources = await stdioResourcesList(client);
      assert.equal(resources.length, WIDGET_COUNT, `Positiv-Kontrolle (stderr: ${stderr()})`);
      for (const resource of resources) {
        const read = await stdioResourceRead(client, resource.uri);
        const content = read.contents[0];
        assert.equal("openai/widgetDomain" in content._meta, false, `${resource.uri}: kein erfundener Origin`);
        assert.deepEqual(content._meta.ui.csp, { connectDomains: [], resourceDomains: [] });
      }
    },
  );
});

function findUiDomainHits(value, parentKey, path) {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findUiDomainHits(item, index, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];
  const ownHit =
    parentKey === "ui" && Object.prototype.hasOwnProperty.call(value, "domain") ? [path] : [];
  const childHits = Object.entries(value).flatMap(([key, val]) => findUiDomainHits(val, key, `${path}.${key}`));
  return [...ownHit, ...childHits];
}

test("T5 (Waechter ui.domain): weder tools/list noch resources/read tragen irgendwo ein Objekt unter 'ui' mit Schluessel 'domain'", async () => {
  const synthetic = { outer: [{ _meta: { ui: { domain: "x" } } }] };
  assert.equal(findUiDomainHits(synthetic, null, "$").length, 1, "Positiv-Kontrolle des Walkers");

  const srv = await startServer({ env: { MCP_UI_ENABLED: "true", PUBLIC_URL: PROBE_ORIGIN } });
  try {
    const { tools } = await httpToolsList(srv.localUrl, null);
    const resources = await httpResourcesList(srv.localUrl, null);
    const reads = await Promise.all(resources.map((resource) => httpResourceRead(srv.localUrl, null, resource.uri)));
    const payload = { tools, resources, reads };
    assert.deepEqual(findUiDomainHits(payload, null, "$"), [], "kein ui.domain irgendwo (HTTP)");
    assert.equal(JSON.stringify(payload).includes("openai/outputTemplate"), false, "kein Skybridge-Alias (HTTP)");

    const widgetTools = tools.filter((tool) => tool._meta?.ui?.resourceUri);
    assert.equal(widgetTools.length, WIDGET_TOOL_COUNT);
    for (const tool of widgetTools) {
      assert.deepEqual(Object.keys(tool._meta.ui), ["resourceUri"], `${tool.name}: _meta.ui NUR resourceUri`);
    }
  } finally {
    await srv.stop();
  }

  await withStdioClient({ MCP_UI_ENABLED: "true", PUBLIC_URL: PROBE_ORIGIN }, async (client, stderr) => {
    const stdioTools = await stdioToolsList(client);
    const stdioResources = await stdioResourcesList(client);
    const stdioReads = await Promise.all(
      stdioResources.map((resource) => stdioResourceRead(client, resource.uri)),
    );
    const payload = { tools: stdioTools, resources: stdioResources, reads: stdioReads };
    assert.deepEqual(findUiDomainHits(payload, null, "$"), [], `kein ui.domain irgendwo (stdio, stderr: ${stderr()})`);
    assert.equal(JSON.stringify(payload).includes("openai/outputTemplate"), false, "kein Skybridge-Alias (stdio)");
  });
});

const JSON_INDENT = 2;
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}
function canonicalJson(value) {
  return JSON.stringify(canonicalize(value), null, JSON_INDENT);
}

test("T6 (Byte-Gleichheit): Skybridge-Capabilities IM tools/list- bzw. resources/read-Request selbst aendern nichts", async () => {
  const srv = await startServer({ env: { MCP_UI_ENABLED: "true", PUBLIC_URL: PROBE_ORIGIN } });
  try {
    const plain = await httpToolsList(srv.localUrl, null);
    const withCaps = await httpToolsList(srv.localUrl, null, { capabilities: SKYBRIDGE_CAPS_IN_REQUEST });
    assert.equal(canonicalJson(withCaps.tools), canonicalJson(plain.tools), "tools/list byte-identisch");

    const resources = await httpResourcesList(srv.localUrl, null);
    const uri = resources[0].uri;
    const readPlain = await httpResourceRead(srv.localUrl, null, uri);
    const readWithCaps = await httpResourceReadWithCapabilities(srv.localUrl, uri, SKYBRIDGE_CAPS_IN_REQUEST);
    assert.equal(canonicalJson(readWithCaps), canonicalJson(readPlain), "resources/read byte-identisch");
    assert.equal(readWithCaps.contents[0].mimeType, "text/html;profile=mcp-app");
  } finally {
    await srv.stop();
  }
});

test("T7 (Quelltext-Waechter): kein chatgpt.js, keine Skybridge-Reste unter src/", () => {
  const dateien = quelltexteUnter("src");
  assert.ok(!dateien.some(([pfad]) => pfad.endsWith("chatgpt.js")), "keine chatgpt.js mehr unter src/");

  const verboten = /capabilityDeclaresChatgptUi|skybridge|openai\/outputTemplate/;
  const treffer = dateien.filter(([, inhalt]) => verboten.test(inhalt));
  assert.deepEqual(treffer.map(([pfad]) => pfad), [], "keine Skybridge-Reste unter src/");

  const positiv = dateien.filter(([, inhalt]) => /capabilityDeclaresUi/.test(inhalt));
  assert.ok(positiv.length >= 1, "Positiv-Kontrolle: capabilityDeclaresUi existiert noch");
});

const DATA_URI_QUOTED = /url\((["'])data:[\s\S]*?\1\)/g;
const DATA_URI_BARE = /url\(data:[^)]*\)/g;
function stripDataUris(html) {
  return html.replace(DATA_URI_QUOTED, "url()").replace(DATA_URI_BARE, "url()");
}

const FORBIDDEN_LOAD_PATTERNS = [
  /https?:\/\//,
  /fetch\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /EventSource/,
  /sendBeacon/,
  /importScripts/,
  /@font-face/,
  /@import/,
  /<iframe/,
  /<embed/,
  /<object/,
  /<link/,
  /<script[^>]*\ssrc=/,
  /window\.open\b/,
  /openExternal/,
];

function findForbiddenLoads(html) {
  const stripped = stripDataUris(html);
  return FORBIDDEN_LOAD_PATTERNS.filter((pattern) => pattern.test(stripped)).map((pattern) => pattern.source);
}

test("T8 (Widget-Scan, T-30-Exaktheit): kein Widget laedt von aussen - weder ueber den Draht noch in-process, in JEDER Sprache", async () => {
  assert.ok(findForbiddenLoads('<img src="https://x.test/a.png">').length >= 1, "https-Treffer");
  assert.ok(findForbiddenLoads('fetch("/x")').length >= 1, "fetch-Treffer");

  const srv = await startServer({ env: { MCP_UI_ENABLED: "true", PUBLIC_URL: PROBE_ORIGIN } });
  try {
    const resources = await httpResourcesList(srv.localUrl, null);
    assert.equal(resources.length, WIDGET_COUNT);
    for (const resource of resources) {
      const read = await httpResourceRead(srv.localUrl, null, resource.uri);
      const html = read.contents[0].text;
      assert.deepEqual(findForbiddenLoads(html), [], `${resource.uri}: laedt von nirgendwo (Draht)`);
    }
  } finally {
    await srv.stop();
  }

  const widgetIds = ["agent-status", "my-number", "calls", "call"];
  for (const widgetId of widgetIds) {
    const html = widgetHtml(widgetId);
    assert.deepEqual(findForbiddenLoads(html), [], `${widgetId}: laedt von nirgendwo (in-process)`);
  }
});

const CHATGPT_RANGES_URL = new URL("../src/ui/chatgpt-egress-ranges.json", import.meta.url);
const CHATGPT_RANGES = JSON.parse(fs.readFileSync(CHATGPT_RANGES_URL, "utf8"));
const [CHATGPT_FIRST_CIDR] = CHATGPT_RANGES.prefixes;
const CHATGPT_SAMPLE_IP = CHATGPT_FIRST_CIDR.ipv4Prefix.split("/")[0];

const OTHER_CLIENT_IP = "160.79.104.10";

test("T9 (ChatGPT-Egress-IP via X-Forwarded-For): _meta.ui.domain gesetzt, gleich PUBLIC_URL-Origin, Alias bleibt", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    seed: twoTenantSeed(),
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      MULTI_TENANT: "true",
      MCP_UI_ENABLED: "true",
      PUBLIC_URL: PROBE_ORIGIN,
    },
  });
  try {
    const aud = `${PROBE_ORIGIN}/mcp`;
    const token = await idp.sign({ sub: TENANT_DE.sub }, { aud });
    const resources = await httpResourcesList(srv.localUrl, token);
    assert.equal(resources.length, WIDGET_COUNT, "Positiv-Kontrolle: genau 4 Widgets");
    for (const resource of resources) {
      const read = await httpResourceReadFromIp(srv.localUrl, token, {
        uri: resource.uri,
        forwardedFor: CHATGPT_SAMPLE_IP,
      });
      const content = read.contents[0];
      assert.equal(content._meta.ui.domain, PROBE_ORIGIN, `${resource.uri}: ui.domain = PUBLIC_URL-Origin`);
      assert.deepEqual(content._meta.ui.csp, { connectDomains: [], resourceDomains: [] });
      assert.equal(
        content._meta["openai/widgetDomain"],
        PROBE_ORIGIN,
        `${resource.uri}: Alias bleibt zusaetzlich gesetzt`,
      );
    }
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("T10 (andere IP, Beispiel Claude 160.79.104.10): kein ui.domain, Alias bleibt", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    seed: twoTenantSeed(),
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      MULTI_TENANT: "true",
      MCP_UI_ENABLED: "true",
      PUBLIC_URL: PROBE_ORIGIN,
    },
  });
  try {
    const aud = `${PROBE_ORIGIN}/mcp`;
    const token = await idp.sign({ sub: TENANT_DE.sub }, { aud });
    const resources = await httpResourcesList(srv.localUrl, token);
    for (const resource of resources) {
      const read = await httpResourceReadFromIp(srv.localUrl, token, {
        uri: resource.uri,
        forwardedFor: OTHER_CLIENT_IP,
      });
      const content = read.contents[0];
      assert.equal("domain" in content._meta.ui, false, `${resource.uri}: kein ui.domain`);
      assert.equal(
        content._meta["openai/widgetDomain"],
        PROBE_ORIGIN,
        `${resource.uri}: Alias bleibt trotzdem gesetzt`,
      );
    }
  } finally {
    await srv.stop();
    await idp.close();
  }
});
