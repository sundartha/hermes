// T2-05 (T-14): Re-Auth-Challenge im Tool-Fehlerergebnis statt HTTP 403 bei
// OAuth-Kein-Mandant. Zwei Teile:
//   Teil 1 (Unit, kein Server-Spawn): buildNoTenantResult() liefert die richtige Form
//     je Sprache; die interne Fassade (_noTenantFacade, Test-Naht) hat GENAU zwei
//     Methoden; registerNoTenantStubs() registriert dieselbe Namensmenge wie
//     registerTools() mit lauter Stub-Handlern, die NIE fetch() ausloesen.
//   Teil 2 (Draht, Kindprozess): echte HTTP-/mcp-Route mit einem Spion-Gateway
//     (zaehlt jeden Request an den internen REST-Hop) UND stdio - Beweis "kein
//     echter Handler laeuft je" ist NUR am Draht fuehrbar (registerTool() des SDK
//     verwirft unbekannte Felder still, ein Registrierungsobjekt beweist nichts).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  startServer,
  startIdp,
  seedState,
  mcpPost,
  toolCall,
  readToolResult,
  waitForLog,
  assertReauthChallenge,
  TOOL_COUNT_WITHOUT_CONSULT,
  ROOT,
  BASE_ENV,
} from "./helpers.js";
import { registerTools } from "../src/mcp-tools.js";
import { registerNoTenantStubs, buildNoTenantResult, _noTenantFacade } from "../src/mcp-no-tenant.js";
import { localeFor } from "../src/i18n/locales.js";
import { TOOL_SECURITY_SCHEMES } from "../src/mcp-security-schemes.js";

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const MCP_WWW_AUTHENTICATE = "mcp/www_authenticate";
const CHALLENGE_PREFIX = 'Bearer resource_metadata="https://agent.test/.well-known/oauth-protected-resource"';
const MCP_SERVER_ENTRYPOINT = "src/mcp-server.js";

// Vollstaendiger initialize-Body (Muster test/mcp-server-icon.test.js): die SDK-Schema-
// Pruefung verlangt protocolVersion/capabilities/clientInfo - ein Body ohne params wird
// mit einem JSON-RPC-Fehler abgelehnt (empirisch verifiziert).
const INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "hermes-t2-05-test-client", version: "0.0.1" },
  },
};

const SUB_C = "sub-mandant-c";
const NUM_C = "+4915110000091"; // aktive DID von Mandant C
const OWNER_NUM = "+18643028341"; // Live-Diskriminator (Owner-Telnyx-DID)

const seedTenantC = () =>
  seedState({
    tenants: [{ id: "tenant-c", status: "active", idpSubject: SUB_C }],
    numbers: [
      {
        id: "num_c",
        e164: NUM_C,
        tenantId: "tenant-c",
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
    ],
  });

// ---------------------------------------------------------------------------------
// Teil 1: Unit - buildNoTenantResult(), die Fassade, registerNoTenantStubs()
// ---------------------------------------------------------------------------------

test("Unit S2: buildNoTenantResult() je Sprache - Form + Inhalt, KEIN Link/URL/Tenant-Auskunft", () => {
  for (const language of ["de", "en", "fr"]) {
    const result = buildNoTenantResult(language);
    assert.equal(result.isError, true);
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "text");
    const text = result.content[0].text;
    assert.ok(text && text.length > 0);
    assert.ok(!text.includes("http"), "kein Link im Fehlertext");
    assert.ok(!text.includes("www."), "keine URL im Fehlertext");
    assert.ok(!text.includes('"'), "kein Anfuehrungszeichen im Fehlertext");
    // Reiner In-Process-Import (kein Server-Spawn, kein BASE_ENV): PUBLIC_URL ist hier
    // NICHT "https://agent.test" (das setzt nur startServer fuer Kindprozesse) - die
    // exakte resource_metadata-URL prueft der Drahttest (T05-1..5) unten.
    const challenge = result._meta[MCP_WWW_AUTHENTICATE];
    assert.ok(Array.isArray(challenge) && challenge.length === 1);
    assert.ok(challenge[0].startsWith("Bearer resource_metadata="));
    assert.ok(challenge[0].includes('error="insufficient_scope"'));
    assert.ok(Object.isFrozen(result), "Ergebnis ist eingefroren");
    assert.ok(Object.isFrozen(result._meta), "_meta ist eingefroren");
  }
  // dieselbe Aussage nochmal ueber localeFor - der Text kommt aus GENAU dieser Quelle,
  // kein zweiter Textbau in mcp-no-tenant.js.
  assert.equal(
    buildNoTenantResult("de").content[0].text,
    localeFor("de").mcp.errors.no_tenant_linked,
  );
});

test("Unit S3 (i): die interne Fassade hat GENAU zwei Methoden, KEIN legacy tool()", () => {
  const facade = _noTenantFacade({ registerTool() {}, registerResource() {} }, async () => ({}));
  assert.equal("tool" in facade, false);
  assert.equal("registerToolTask" in facade, false);
  assert.deepEqual(Object.keys(facade).sort(), ["registerResource", "registerTool"]);
});

test("Unit S3 (i): eine fehlende Server-Methode wirft TypeError statt still zu verpuffen", () => {
  // Nur registerTool vorhanden - ruft die Fassade registerResource auf (was hier nicht
  // passiert, da uiHost:null keine Widgets registriert), waere das ein TypeError. Diese
  // Zusicherung haelt direkt fest, dass die Fassade NICHTS ausser den zwei Methoden
  // vorspiegelt (kein Proxy-Fallback, s. Kommentar mcp-no-tenant.js).
  const bareServer = { registerTool() {} };
  const facade = _noTenantFacade(bareServer, async () => ({}));
  assert.throws(() => facade.registerResource("ui://x", {}), TypeError);
});

function makeFakeServer() {
  const tools = new Map();
  return {
    tools,
    registerTool(name, config, handler) {
      tools.set(name, { config, handler });
    },
    registerResource() {
      // uiHost:null in diesem Test -> registerTools ruft dies nie auf.
    },
  };
}

test("Unit S3 (ii+iii): registerNoTenantStubs registriert dieselbe Namensmenge, jeder Handler ist der Stub, NIE fetch()", async () => {
  const ctx = {
    identity: null,
    scopedTenant: "tenant-c",
    allowCalendar: true,
    consultAllowed: false,
    uiHost: null,
    language: "de",
  };
  const real = makeFakeServer();
  registerTools(real, ctx);
  const stub = makeFakeServer();
  registerNoTenantStubs(stub, ctx);

  assert.deepEqual(
    [...stub.tools.keys()].sort(),
    [...real.tools.keys()].sort(),
    "gleiche Werkzeugnamen wie der echte Registrierweg",
  );
  assert.equal(stub.tools.size, TOOL_COUNT_WITHOUT_CONSULT);

  let fetchCalls = 0;
  const countingFetch = async () => {
    fetchCalls += 1;
    return new Response("{}", { status: 200 });
  };
  const origFetch = globalThis.fetch;
  globalThis.fetch = countingFetch;
  try {
    for (const [name, { handler }] of stub.tools) {
      const result = await handler({}, {});
      assert.equal(result.isError, true, `${name}: Stub-Ergebnis ist isError`);
      assert.equal(result._meta[MCP_WWW_AUTHENTICATE].length, 1, `${name}: genau eine Challenge`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }
  assert.equal(fetchCalls, 0, "kein Stub-Handler ruft je fetch()/api()");
});

// ---------------------------------------------------------------------------------
// Teil 2: Draht - HTTP OAuth mit Spion-Gateway, HTTP Token/Legacy, stdio
// ---------------------------------------------------------------------------------

async function startSpyGateway() {
  let count = 0;
  const SPY_HTTP_NOT_FOUND = 404;
  const server = http.createServer((_req, res) => {
    count += 1;
    res.writeHead(SPY_HTTP_NOT_FOUND, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "spy-not-found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    get url() {
      return `http://127.0.0.1:${server.address().port}`;
    },
    get count() {
      return count;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const oauthEnv = (idp, spy, extra = {}) => ({
  MCP_AUTH: "oauth",
  OAUTH_ISSUER_URL: idp.issuer,
  GATEWAY_URL: spy.url,
  ...extra,
});

// Gemeinsames Setup fuer T05-1..5: EIN Server, EIN Spion, zwei Tokens (Mandant C
// echt, ein zweites unbekannt/subloses je Test). G5: kein viertes Mal denselben
// Server-Aufbau kopieren.
async function withOauthFixture(run) {
  const idp = await startIdp();
  const spy = await startSpyGateway();
  const srv = await startServer({
    env: oauthEnv(idp, spy),
    seed: seedTenantC(),
    ownerNumber: { e164: OWNER_NUM, provider: "telnyx" },
  });
  try {
    await run({ idp, spy, srv });
  } finally {
    await srv.stop();
    await spy.close();
    await idp.close();
  }
}

async function callAsUrl(srv, token, { name, args = {} }) {
  const res = await mcpPost(`${srv.localUrl}/mcp`, token, toolCall(name, args));
  assert.equal(res.status, HTTP_OK);
  return readToolResult(res);
}

test("T05-1 (unbekannter sub, localhost): initialize/tools/list unveraendert, place_call -> Challenge, Spion 0, kein Anruf im Store", async () => {
  await withOauthFixture(async ({ idp, spy, srv }) => {
    const ghostToken = await idp.sign({ sub: "sub-unbekannt-t05" });
    const realToken = await idp.sign({ sub: SUB_C });

    const initRes = await mcpPost(`${srv.localUrl}/mcp`, ghostToken, INITIALIZE_BODY);
    assert.equal(initRes.status, HTTP_OK);
    const initResult = await readToolResult(initRes);
    assert.ok(initResult.serverInfo);

    const listRes = await mcpPost(`${srv.localUrl}/mcp`, ghostToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    assert.equal(listRes.status, HTTP_OK);
    const ghostTools = (await readToolResult(listRes)).tools;
    const realListRes = await mcpPost(`${srv.localUrl}/mcp`, realToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const realTools = (await readToolResult(realListRes)).tools;
    // W3 (PLAN-OPENAI-TECHNIK-2.md): Mandant C traegt DEFAULT_PROFILE (allowCalendar
    // false) - die Zahl weicht deshalb von TOOL_COUNT_WITHOUT_CONSULT (Owner-Profil,
    // allowCalendar true, s. T05-8) ab; entscheidend ist die Gleichheit ghost==real -
    // Kein-Mandant liefert exakt dieselbe Menge wie derselbe Mandant MIT Zuordnung.
    assert.equal(ghostTools.length, realTools.length);
    assert.ok(ghostTools.length > 0, "die Tool-Liste ist NICHT leer (sichtbar, nur der Aufruf ist gesperrt)");
    for (const toolDesc of ghostTools) {
      assert.deepEqual(toolDesc.securitySchemes, TOOL_SECURITY_SCHEMES);
    }

    const callRes = await mcpPost(
      `${srv.localUrl}/mcp`,
      ghostToken,
      toolCall("place_call", { to: "+4915112345678", objective: "Testtermin" }),
    );
    assert.equal(callRes.status, HTTP_OK);
    const result = await readToolResult(callRes);
    assertReauthChallenge(result);
    assert.ok(!JSON.stringify(result).includes(OWNER_NUM), "NIE die Owner-Nummer");

    assert.equal(spy.count, 0, "der Stub ruft NIE den internen REST-Hop");
    assert.equal(srv.readStore().calls.length, 0, "kein neuer Anruf im Store");
    await waitForLog(srv, /\[audit\] auth_failed .*path=\/mcp grund=kein_tenant/);
    assert.ok(!/requestedBy=owner/.test(srv.stdout));
  });
});

test("T05-2 (verifiziertes Token OHNE sub): place_call und get_my_number -> Challenge, Spion 0", async () => {
  await withOauthFixture(async ({ idp, spy, srv }) => {
    const noSubToken = await idp.sign({ email: "ghost@team.test" }, { noSubject: true });
    for (const [name, args] of [
      ["place_call", { to: "+4915112345678", objective: "Testtermin" }],
      ["get_my_number", {}],
    ]) {
      const result = await callAsUrl(srv, noSubToken, { name, args });
      assertReauthChallenge(result);
    }
    assert.equal(spy.count, 0);
  });
});

test("T05-3 (zweites/drittes Werkzeug): get_my_number und list_calls -> dieselbe Challenge, Spion 0", async () => {
  await withOauthFixture(async ({ idp, spy, srv }) => {
    const ghostToken = await idp.sign({ sub: "sub-unbekannt-t05-3" });
    const numberResult = await callAsUrl(srv, ghostToken, { name: "get_my_number" });
    const callsResult = await callAsUrl(srv, ghostToken, { name: "list_calls" });
    assertReauthChallenge(numberResult);
    assertReauthChallenge(callsResult);
    assert.deepEqual(
      numberResult._meta[MCP_WWW_AUTHENTICATE],
      callsResult._meta[MCP_WWW_AUTHENTICATE],
      "dieselbe Challenge fuer jedes Werkzeug (eine Quelle)",
    );
    assert.equal(spy.count, 0);
  });
});

test("T05-4 POSITIV-KONTROLLE: Mandant C (echtes Token) -> get_my_number erreicht den echten Handler, Spion >= 1, KEINE Challenge", async () => {
  await withOauthFixture(async ({ idp, spy, srv }) => {
    const realToken = await idp.sign({ sub: SUB_C });
    const result = await callAsUrl(srv, realToken, { name: "get_my_number" });
    assert.equal(result._meta?.[MCP_WWW_AUTHENTICATE], undefined, "kein Challenge-Feld im echten Ergebnis");
    assert.ok(spy.count >= 1, "der echte Handler ruft den internen REST-Hop auf - sonst beweist Spion=0 nichts");
  });
});

test("T05-5: dieselben resource_metadata/scope-Parameter wie der HTTP-401-Header", async () => {
  await withOauthFixture(async ({ idp, srv }) => {
    const ghostToken = await idp.sign({ sub: "sub-unbekannt-t05-5" });
    const challengeResult = await callAsUrl(srv, ghostToken, { name: "get_my_number" });
    const challenge = challengeResult._meta[MCP_WWW_AUTHENTICATE][0];

    const noTokenRes = await mcpPost(`${srv.localUrl}/mcp`, null);
    assert.equal(noTokenRes.status, HTTP_UNAUTHORIZED);
    const header = noTokenRes.headers.get("www-authenticate");

    const paramOf = (str, key) => str.match(new RegExp(`${key}="([^"]*)"`))?.[1];
    assert.equal(paramOf(challenge, "resource_metadata"), paramOf(header, "resource_metadata"));
    assert.equal(paramOf(challenge, "scope"), paramOf(header, "scope"));
  });
});

test("T05-6: Token-Modus unveraendert - HTTP 403, kein mcp/www_authenticate im Body", async () => {
  const srv = await startServer({
    env: { MCP_AUTH: "token", MCP_AUTH_TOKEN: "tok-t05-6" },
    seed: seedTenantC(),
    ownerNumber: { e164: OWNER_NUM, provider: "telnyx" },
  });
  try {
    const res = await mcpPost(`${srv.externalUrl || srv.localUrl}/mcp`, "tok-t05-6", toolCall("get_my_number"));
    assert.equal(res.status, HTTP_FORBIDDEN);
    const body = await res.json();
    assert.deepEqual(body, { error: "Keine Tenant-Zuordnung fuer diese Identitaet." });
    assert.ok(!JSON.stringify(body).includes("www_authenticate"));
  } finally {
    await srv.stop();
  }
});

test("T05-7: Legacy-Modus unveraendert - 401 ohne resource_metadata, kein JSON-RPC-Ergebnis", async () => {
  const srv = await startServer({
    env: { MCP_AUTH: "" },
    seed: seedTenantC(),
    ownerNumber: { e164: OWNER_NUM, provider: "telnyx" },
  });
  try {
    const res = await mcpPost(`${srv.externalUrl || srv.localUrl}/mcp`, null, toolCall("get_my_number"));
    assert.equal(res.status, HTTP_UNAUTHORIZED);
    const header = res.headers.get("www-authenticate") || "";
    assert.ok(header.startsWith('Bearer error="invalid_token"'));
    assert.ok(!header.includes("resource_metadata"));
    const body = await res.json();
    assert.ok(!("jsonrpc" in body), "kein JSON-RPC-Ergebnis, nur der Auth-Fehler");
  } finally {
    await srv.stop();
  }
});

test("T05-8: stdio unveraendert - echter Handler laeuft, KEINE Challenge, tools/list = TOOL_COUNT_WITHOUT_CONSULT", async () => {
  const spy = await startSpyGateway();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER_ENTRYPOINT],
    cwd: ROOT,
    env: { ...BASE_ENV, GATEWAY_URL: spy.url },
    stderr: "pipe",
  });
  const client = new Client({ name: "hermes-t2-05-stdio-client", version: "0.0.0" });
  try {
    await client.connect(transport);
    const list = await client.listTools();
    assert.equal(list.tools.length, TOOL_COUNT_WITHOUT_CONSULT);
    const result = await client.callTool({ name: "get_my_number", arguments: {} });
    assert.equal(result._meta?.[MCP_WWW_AUTHENTICATE], undefined);
    assert.ok(spy.count >= 1, "stdio ruft den echten Handler auf, nie den Stub");
  } finally {
    await client.close();
    await spy.close();
  }
});

test("T05-9: ungueltiges Token (falsche Signatur) -> weiterhin HTTP 401 mit oauth-Challenge, kein Tool-Ergebnis", async () => {
  await withOauthFixture(async ({ idp, srv }) => {
    const badToken = await idp.sign({ sub: SUB_C }, { key: idp.wrongKey });
    const res = await mcpPost(`${srv.localUrl}/mcp`, badToken, toolCall("get_my_number"));
    assert.equal(res.status, HTTP_UNAUTHORIZED);
    const header = res.headers.get("www-authenticate") || "";
    assert.ok(header.startsWith(CHALLENGE_PREFIX));
    const body = await res.json();
    assert.ok(!("jsonrpc" in body), "kein JSON-RPC-Ergebnis bei ungueltiger Signatur");
  });
});
