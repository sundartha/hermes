// T2-01 (T-30/T-31/T-23): Draht-Beweise fuer csp/Origin am RESOURCE-INHALT
// (resources/read, uiResourceMeta in src/ui/contract.js) und dafuer, dass der
// Skybridge-/ChatGPT-Adapter ersatzlos entfernt ist. Alle Faelle lesen ROH (eigenes
// JSON.parse ueber HTTP, bzw. client.request() mit einem passthrough-Schema ueber
// stdio) - nie einen typisierten SDK-Client, weil registerTool()/registerResource() die
// generierten Result-Schemas unbekannte Felder still verwerfen (Lehre B-Serie,
// P3-Test). Testname traegt bewusst KEIN Katalog-/ABNAHME-Praefix (sonst landet er im
// falschen Lauf, package.json config.i18nCatalogPattern/abnahmePattern).
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
const HTTP_OK = 200;
const MCP_SERVER_ENTRYPOINT = "src/mcp-server.js";
const EXTERNAL_IP = externalIp();
const PROBE_ORIGIN = "https://probe.example";
const EXPECTED_META = {
  ui: { csp: { connectDomains: [], resourceDomains: [] } },
  "openai/widgetDomain": PROBE_ORIGIN,
};
// Permissives Ergebnis-Schema fuer rohe Requests ueber den typisierten SDK-Client
// (z.any() umgeht das Strippen unbekannter Schluessel, Messung B/P3-Muster).
const ANY = z.object({}).passthrough();
const SKYBRIDGE_CAPS_IN_REQUEST = {
  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html+skybridge"] } },
};

// ---- geteilte Helfer -------------------------------------------------------------

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

// Nur fuer die T1-Positiv-Kontrolle (Review-Befund): liest die servergerenderte
// Widget-Sprache eines Mandanten ueber den ECHTEN Draht - get_agent_number ist ein
// Widget-Tool (uiTool) und traegt sie seit T2-02 an result._meta[WIDGET_LOCALE_META_KEY]
// (mcp-tools.js withWidgetLocale), NICHT mehr an der Resource selbst.
async function httpWidgetLocale(baseUrl, token) {
  const res = await mcpPost(`${baseUrl}/mcp`, token, toolCall("get_agent_number"));
  const result = await readToolResult(res);
  return result._meta?.[WIDGET_LOCALE_META_KEY];
}

// Nur fuer T9/T10 (ui.domain-Erkennung ueber die Client-IP): mcpPost (helpers.js)
// nimmt keinen Header-Parameter - eigene, schlanke Variante statt eines vierten
// Positionsarguments an mcpPost (F1/G30). uri+forwardedFor als EIN Objekt (F1: max 3
// Argumente) - beide beschreiben denselben Request, kein viertes Positionsargument.
// "trust proxy" (app.js, ungeaendert) leitet req.ip aus GENAU diesem Header ab, auch
// wenn die TCP-Verbindung selbst ueber Loopback laeuft (belegt: Node net.Server-Probe,
// s. Kommentar an chatgpt-egress.js) - deshalb reicht srv.localUrl hier aus.
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

// Nur fuer T6 (Byte-Gleichheit trotz Skybridge-Capabilities IM Request): traegt
// zusaetzlich params.capabilities. Eigene Funktion statt eines vierten Parameters an
// httpResourceRead (max-params, G30/G34).
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

// Owner-Nummer (Boot-Guard) + zwei per idpSubject gebundene Tenants mit eigener DID und
// verschiedener Sprache - Muster test/mcp-tools-i18n.test.js twoLanguageTenantSeed.
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

// Kurzform fuer den Text EINES gelesenen Resource-Inhalts (G36: haelt die Aufrufkette
// in der T-34-Kernabnahme unten auf hoechstens 4 verkettete Zugriffe - Muster wie
// assertAllFiveResourcesCarryExpectedMeta unten, read+content je eigene Zeile).
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

// ==================== T1: HTTP OAuth ====================

test("T1 (HTTP OAuth): alle 5 Widget-Resources tragen den Sollwert, identisch ueber zwei Tenants verschiedener Sprache", async (ctx) => {
  if (!EXTERNAL_IP) return ctx.skip("keine externe Interface-IP");
  const idp = await startIdp();
  const srv = await startServer({
    seed: twoTenantSeed(),
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, MULTI_TENANT: "true", MCP_UI_ENABLED: "true", PUBLIC_URL: PROBE_ORIGIN },
  });
  try {
    // aud explizit: die kanonische Audience folgt PUBLIC_URL (`${origin}/mcp`,
    // src/auth.js audience()) - BASE_ENV.PUBLIC_URL ("https://agent.test") gilt hier
    // NICHT, dieser Test setzt PUBLIC_URL bewusst auf PROBE_ORIGIN (s.o.).
    const aud = `${PROBE_ORIGIN}/mcp`;
    const [tokenDe, tokenEn] = await Promise.all([
      idp.sign({ sub: TENANT_DE.sub }, { aud }),
      idp.sign({ sub: TENANT_EN.sub }, { aud }),
    ]);
    // readsByTenant statt Ueberschreiben je Schleifendurchlauf (Review-Befund): der
    // Text-Vergleich unten braucht BEIDE Mandanten gleichzeitig, nicht nur den
    // zuletzt gelesenen.
    const readsByTenant = [];
    for (const token of [tokenDe, tokenEn]) {
      const resources = await httpResourcesList(srv.externalUrl, token);
      const reads = {};
      for (const resource of resources) reads[resource.uri] = await httpResourceRead(srv.externalUrl, token, resource.uri);
      assertAllFiveResourcesCarryExpectedMeta(resources, reads);
      readsByTenant.push(reads);
    }
    const [readsDe, readsEn] = readsByTenant;

    // Positiv-Kontrolle (Review-Befund): beweist, dass tokenDe/tokenEn nachweislich
    // verschiedene Agentensprachen tragen. Ohne sie waere ein Byte-Gleich-Befund unten
    // wertlos - er koennte auch gelten, weil beide Mandanten zufaellig dieselbe Sprache
    // haben.
    const [localeDe, localeEn] = await Promise.all([
      httpWidgetLocale(srv.externalUrl, tokenDe),
      httpWidgetLocale(srv.externalUrl, tokenEn),
    ]);
    assert.equal(localeDe, "de", "Positiv-Kontrolle: DE-Mandant meldet de");
    assert.equal(localeEn, "en", "Positiv-Kontrolle: EN-Mandant meldet en");

    // T-34-Kernabnahme (Review-Befund, ersetzt die geloeschte Tautologie ex UI-18):
    // die Resource selbst ist sprachneutral - jede URI liefert byte-gleichen Text ueber
    // beide Mandanten, obwohl deren Sprache nachweislich verschieden ist (s.o.).
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

// ==================== T2: HTTP Token/Legacy ====================
//
// Rechercheergebnis (kein Raten - am laufenden Server gemessen, src/auth.js +
// src/routes/_tenant.js): der statische Bearer-Modus (MCP_AUTH=token) setzt NIE
// req.auth (nur der OAuth-Zweig tut das). Ohne req.auth loest requestTenant ueber
// operatorChannelTenant auf, und das greift NUR fuer isTrustedLocalCaller (echter
// Loopback-Socket, s. src/routes/_tenant.js:100-101) - unabhaengig vom Bearer. Ein
// korrekter Token ueber die Interface-IP authentifiziert damit zwar den DRAHT, liefert
// aber NIE eine Tenant-Identitaet -> 403 "Keine Tenant-Zuordnung", bevor registerTools
// je laeuft. Das ist Absicht (fail-closed: statischer Token = Single-Operator-Loopback,
// keine Multi-Tenant-Identitaet) und keine Luecke von T2-01. Der "Token"-Pfad, auf dem
// Widgets ueberhaupt erreichbar sind, ist deshalb LOOPBACK MIT korrektem Bearer -
// das ist die reale Nutzung (ein lokaler Client mit MCP_AUTH_TOKEN).
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

// ==================== T3: stdio ====================

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

// ==================== T4: stdio ohne PUBLIC_URL ====================

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

// ==================== T5: Waechter ui.domain (Standardfall: keine ChatGPT-IP) ====================
//
// T2-01 Nachbau: dieser Waechter gilt fuer JEDEN Request in diesem Test - weder ueber
// srv.localUrl (Loopback) noch ueber stdio traegt der Aufruf eine ChatGPT-Egress-IP
// (chatgpt-egress.js), also bleibt `ui.domain` in BEIDEN Faellen zurecht abwesend. Der
// Positiv-Beleg fuer den ChatGPT-Fall steht in T9 (unten), die Negativ-Kontrolle mit
// einer echten, nicht gelisteten IP in T10.

// Meldet jedes Objekt unter Schluessel "ui", das selbst einen Schluessel "domain"
// traegt - unabhaengig von der Tiefe. Rekursiv ueber Arrays/Objekte, Basisfall (String/
// Zahl/null) liefert nichts.
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
  // Positiv-Kontrolle im selben Test: der Walker MUSS auf einer bekannten Verletzung
  // feuern, sonst beweist ein leerer Fund nichts (Pruefkommando-ohne-Positiv-Kontrolle).
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
    assert.equal(widgetTools.length, WIDGET_COUNT);
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

// ==================== T6: Byte-Gleichheit trotz Skybridge-Capabilities im Request ====================

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

// ==================== T7: Quelltext-Waechter ====================

test("T7 (Quelltext-Waechter): kein chatgpt.js, keine Skybridge-Reste unter src/", () => {
  const dateien = quelltexteUnter("src");
  assert.ok(!dateien.some(([pfad]) => pfad.endsWith("chatgpt.js")), "keine chatgpt.js mehr unter src/");

  const verboten = /capabilityDeclaresChatgptUi|skybridge|openai\/outputTemplate/;
  const treffer = dateien.filter(([, inhalt]) => verboten.test(inhalt));
  assert.deepEqual(treffer.map(([pfad]) => pfad), [], "keine Skybridge-Reste unter src/");

  // Positiv-Kontrolle: derselbe Scanner findet den ueberlebenden Detektor.
  const positiv = dateien.filter(([, inhalt]) => /capabilityDeclaresUi/.test(inhalt));
  assert.ok(positiv.length >= 1, "Positiv-Kontrolle: capabilityDeclaresUi existiert noch");
});

// ==================== T8: Widget-Scan "laedt von nirgendwo" ====================

// data:-URIs vor dem Scan entfernen: bis zum SCHLIESSENDEN Anfuehrungszeichen/Klammer
// des url(...), nicht bis zum ersten - im call-Widget stehen einfache
// Anfuehrungszeichen (SVG-xmlns) INNERHALB eines mit doppelten Anfuehrungszeichen
// eingefassten data:-URI. Rueckverweis \1 erzwingt denselben Anfuehrungszeichen-Typ.
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
  // Positiv-Kontrolle: der Scanner MUSS auf bekannten Ladeversuchen feuern.
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

  // T2-02/T-34: EINE sprachneutrale Fassung je Widget statt einer Sprachmatrix -
  // widgetHtml() nimmt keine Sprache mehr entgegen (s. widget-catalog.js).
  const widgetIds = ["agent-status", "my-number", "calls", "call"];
  for (const widgetId of widgetIds) {
    const html = widgetHtml(widgetId);
    assert.deepEqual(findForbiddenLoads(html), [], `${widgetId}: laedt von nirgendwo (in-process)`);
  }
});

// ==================== T9/T10: ui.domain NUR bei nachweislicher ChatGPT-Egress-IP ====================
//
// T2-01 Nachbau (Owner-Entscheidung): `ui.domain` wird ZUSAETZLICH zum Alias
// openai/widgetDomain gesetzt, wenn und NUR wenn die Anfrage ueber die
// veroeffentlichten ChatGPT-Egress-IP-Bereiche (chatgpt-egress.js,
// chatgpt-egress-ranges.json) als ChatGPT erkannt wird. Beide Tests laufen ueber die
// ECHTE HTTP-Route (kein registerResource()-Unit-Test - der SDK-Client wuerde ein
// unbekanntes _meta-Feld ohnehin still verwerfen, s. Dateikopf).
//
// Eine ECHTE IP aus der eingecheckten Liste - kein erfundener Wert, sonst prueft der
// Test nur sich selbst (Positiv-Kontrolle als Lesart, nicht als Code: chatgpt-
// egress.test.js deckt das Modul isoliert ab).
const CHATGPT_RANGES_URL = new URL("../src/ui/chatgpt-egress-ranges.json", import.meta.url);
const CHATGPT_RANGES = JSON.parse(fs.readFileSync(CHATGPT_RANGES_URL, "utf8"));
const [CHATGPT_FIRST_CIDR] = CHATGPT_RANGES.prefixes;
const CHATGPT_SAMPLE_IP = CHATGPT_FIRST_CIDR.ipv4Prefix.split("/")[0];

// Reale, NICHT gelistete IP - vom Owner-Auftrag namentlich als Beispiel genannt
// ("z.B. 160.79.104.10, Claude").
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
