// T2-13 (N-10): Abnahme am echten Draht (HTTP /mcp Legacy/Bootstrap, HTTP /mcp OAuth,
// stdio) fuer die serverseitige Bestaetigung vor dem Waehlen. (a)-(g) decken die
// kritischsten Kriterien ueber HTTP-Legacy ab; (h) beweist denselben Rundlauf (prepare_call
// -> place_call) ueber einen ECHTEN gespawnten stdio-Kindprozess (Muster
// test/openai-p5b-geldpfad.test.js Fall C); (i) beweist die Tenant-Bindung ueber ein ECHTES,
// signiertes OAuth-Token durch /mcp (ein Mandant bestaetigt, ein ANDERER versucht mit
// demselben Code zu waehlen -> isError, kein Anruf) - vorher war die Tenant-Bindung nur
// indirekt ueber X-Internal-Tenant direkt an der Route belegt (profile-tenant-key.test.js).
// Die Consult-Variante bleibt offen (s. Uebergabe).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { KYC_LEVEL } from "../src/store/defaults.js";
import { planProfileFor } from "../src/plans.js";
import {
  startServer,
  startIdp,
  mcpPost,
  toolCall,
  readToolResult,
  seedState,
  ROOT,
  BASE_ENV,
} from "./helpers.js";

const TEST_SECRET = "openai-t2-13-abnahme-test-secret-mind-32-zeichen";
const TARGET = "+4915112340099";
const OBJECTIVE = "Termin vereinbaren";
const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{6}$/;
const CONFIRMATION_META_KEY = "hermes/confirmation_code";

async function withServer(run) {
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      ALLOWED_COUNTRY_CODES: "*",
      MCP_UI_ENABLED: "true",
      CALL_CONFIRMATION_SECRET: TEST_SECRET,
    },
  });
  try {
    await run(srv);
  } finally {
    await srv.stop();
  }
}

async function prepareCall(srv, args) {
  const res = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("prepare_call", args));
  return readToolResult(res);
}

async function placeCall(srv, args) {
  const res = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("place_call", args));
  return readToolResult(res);
}

function sha256OfFile(path) {
  return createHash("sha256").update(fs.readFileSync(path)).digest("hex");
}

test("(a) prepare_call: Code in _meta, NICHT in content/structuredContent; structuredContent.to normalisiert", async () => {
  await withServer(async (srv) => {
    const result = await prepareCall(srv, { to: TARGET, objective: OBJECTIVE });
    assert.notEqual(result.isError, true, "prepare_call darf kein isError sein");
    const code = result._meta?.[CONFIRMATION_META_KEY];
    assert.match(code, CODE_PATTERN, "der Code passt auf das Crockford-Base32-Alphabet, Laenge 6");
    // Substring-Suche nach dem KONKRETEN Codewert, nicht nach dem verankerten Muster:
    // ein JSON-String beginnt mit "[" bzw. "{" und ist immer laenger als 6 Zeichen, ^...$
    // kann darin also nie treffen - das war blind gruen, egal was im Text stand.
    assert.ok(!JSON.stringify(result.content).includes(code), "Code steht nicht im Modelltext");
    assert.ok(
      !JSON.stringify(result.structuredContent).includes(code),
      "Code steht nicht in structuredContent",
    );
    // Positiv-Kontrolle: die Pruefung selbst muss einen eingebauten Code finden koennen,
    // sonst waere auch das `includes` oben nur ein weiterer Blindgaenger.
    assert.ok(JSON.stringify({ leak: code }).includes(code), "Positiv-Kontrolle: includes() findet einen eingebauten Code");
    assert.equal(result.structuredContent.status, "awaiting_confirmation");
    assert.equal(result.structuredContent.to, TARGET, "to bleibt E.164 (bereits normalisiert eingegeben)");
  });
});

test("(b) place_call ohne Code / mit leerem Code / mit erfundenem Code: isError, kein Anruf", async () => {
  await withServer(async (srv) => {
    const before = srv.readStore().calls.length;
    for (const confirmation_code of [undefined, "", "ZZZZZZ"]) {
      const args = { to: TARGET, objective: OBJECTIVE };
      if (confirmation_code !== undefined) args.confirmation_code = confirmation_code;
      const result = await placeCall(srv, args);
      assert.equal(result.isError, true, `confirmation_code=${JSON.stringify(confirmation_code)}`);
      const text = result.content[0].text;
      // Weltdefault-Sprache ist Englisch (kein Tenant-Sprachkontext auf diesem Pfad) -
      // der deutsche Wortlaut "Host ohne Karte" aus der Spec ist die DE-Fassung
      // desselben Satzes (loc.mcp.confirmationRequired, src/i18n/mcp-texts.js).
      assert.match(text, /host without a card/i);
      assert.match(text, new RegExp(TARGET.replace("+", "\\+")), "nennt das (normalisierte) Ziel");
      assert.match(text, /Termin vereinbaren/, "nennt das Anliegen");
      assert.doesNotMatch(text, /Input validation error/);
    }
    assert.equal(srv.readStore().calls.length, before, "kein Call-Datensatz entstanden");
  });
});

test("(c) gueltiger Code: place_call waehlt, call_id vorhanden, danach get_call_status funktioniert", async () => {
  await withServer(async (srv) => {
    const prep = await prepareCall(srv, { to: TARGET, objective: OBJECTIVE });
    const confirmation_code = prep._meta[CONFIRMATION_META_KEY];
    const result = await placeCall(srv, { to: TARGET, objective: OBJECTIVE, confirmation_code });
    assert.notEqual(result.isError, true);
    assert.ok(result.structuredContent.call_id, "call_id vorhanden");
    const statusRes = await mcpPost(
      `${srv.localUrl}/mcp`,
      null,
      toolCall("get_call_status", { call_id: result.structuredContent.call_id }),
    );
    const status = await readToolResult(statusRes);
    assert.notEqual(status.isError, true, "get_call_status funktioniert mit dieser call_id");
  });
});

test("(d) geaendertes Argument / geaenderter Mandant / zweiter Verbrauch desselben Codes: jeweils isError, kein Anruf", async () => {
  await withServer(async (srv) => {
    const before = srv.readStore().calls.length;
    const prep = await prepareCall(srv, { to: TARGET, objective: OBJECTIVE });
    const code = prep._meta[CONFIRMATION_META_KEY];

    const changedObjective = await placeCall(srv, {
      to: TARGET,
      objective: "Anderes Anliegen",
      confirmation_code: code,
    });
    assert.equal(changedObjective.isError, true, "geaendertes objective wird abgelehnt");

    const changedTo = await placeCall(srv, {
      to: "+4915112340098",
      objective: OBJECTIVE,
      confirmation_code: code,
    });
    assert.equal(changedTo.isError, true, "geaendertes to wird abgelehnt");

    const first = await placeCall(srv, { to: TARGET, objective: OBJECTIVE, confirmation_code: code });
    assert.notEqual(first.isError, true, "Vorbedingung: der unveraenderte Code funktioniert einmal");
    const second = await placeCall(srv, { to: TARGET, objective: OBJECTIVE, confirmation_code: code });
    assert.equal(second.isError, true, "derselbe Code ein zweites Mal wird abgelehnt (Einmal-Verbrauch)");

    assert.equal(srv.readStore().calls.length, before + 1, "genau EIN Anruf ist aus diesem Block entstanden");
  });
});

test("(e) prepare_call veraendert den Store nicht (sha256 vorher/nachher gleich), keine Codewert-Spur im Log", async () => {
  await withServer(async (srv) => {
    const storePath = srv.dataDir ? `${srv.dataDir}/store.json` : null;
    const before = storePath && fs.existsSync(storePath) ? sha256OfFile(storePath) : null;
    const result = await prepareCall(srv, { to: TARGET, objective: OBJECTIVE });
    const code = result._meta[CONFIRMATION_META_KEY];
    if (before) {
      const after = sha256OfFile(storePath);
      assert.equal(after, before, "prepare_call schreibt nichts in den Store");
    }
    assert.doesNotMatch(srv.stdout + srv.stderr, new RegExp(code), "der Codewert steht in keiner Server-Logzeile");
  });
});

test("(f) gueltiger Code umgeht kein Gate: OUTBOUND_FROZEN lehnt weiterhin ab, kein Anruf", async () => {
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      ALLOWED_COUNTRY_CODES: "*",
      MCP_UI_ENABLED: "true",
      CALL_CONFIRMATION_SECRET: TEST_SECRET,
      OUTBOUND_FROZEN: "true",
    },
  });
  try {
    const before = srv.readStore().calls.length;
    const prep = await prepareCall(srv, { to: TARGET, objective: OBJECTIVE });
    const code = prep._meta[CONFIRMATION_META_KEY];
    const result = await placeCall(srv, { to: TARGET, objective: OBJECTIVE, confirmation_code: code });
    assert.equal(result.isError, true, "OUTBOUND_FROZEN blockt trotz gueltigem Code");
    assert.equal(srv.readStore().calls.length, before, "kein Anruf trotz gueltigem Code");
  } finally {
    await srv.stop();
  }
});

test("(g) ohne CALL_CONFIRMATION_SECRET: prepare_call ist isError, kein Anruf moeglich", async () => {
  const srv = await startServer({
    env: { FAKE_ORIGINATE: "true", ALLOWED_COUNTRY_CODES: "*", MCP_UI_ENABLED: "true" },
  });
  try {
    const result = await prepareCall(srv, { to: TARGET, objective: OBJECTIVE });
    assert.equal(result.isError, true, "ohne Secret ist prepare_call isError");
    assert.doesNotMatch(result.content[0].text, /CALL_CONFIRMATION_SECRET/, "kein Env-Name im Client-Text");
  } finally {
    await srv.stop();
  }
});

// ==================== (h) stdio: echter Kindprozess, echter Rundlauf ======================
// Zwei echte Prozesse wie in der Produktion: EIN voller Gateway (startServer, traegt
// /api/call-confirmations + /api/calls) und EIN stdio-MCP-Server (src/mcp-server.js), der
// seine Tool-Aufrufe per GATEWAY_URL an den Gateway weiterreicht (Muster P5b Fall C). stdio
// ruft registerTools() ohne ctx auf (identity/scopedTenant null -> Owner, Kommentar
// mcp-tools.js:1095) - der Gateway laeuft deshalb OHNE MULTI_TENANT (Bootstrap-Owner).
// MCP_UI_ENABLED muss im KIND-Prozess an sein (der liest den Schalter aus SEINEM env, nicht
// aus dem des Gateways) - sonst bekaeme kein Client, auch stdio nicht, je einen Code (s.
// Korrektur PLAN-SECURITY.md/mcp-tools.js: der Schalter ist global, keine Host-Erkennung).
test("(h) stdio (echter Kindprozess): prepare_call -> place_call Rundlauf ueber einen echten tools/call", async () => {
  const gateway = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      ALLOWED_COUNTRY_CODES: "*",
      CALL_CONFIRMATION_SECRET: TEST_SECRET,
    },
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/mcp-server.js"],
    cwd: ROOT,
    env: { ...BASE_ENV, GATEWAY_URL: gateway.localUrl, MCP_UI_ENABLED: "true" },
    stderr: "pipe",
  });
  let stderrOutput = "";
  transport.stderr?.on("data", (chunk) => {
    stderrOutput += chunk.toString();
  });
  const client = new Client({ name: "hermes-t2-13-stdio-client", version: "0.0.0" });
  try {
    await client.connect(transport);
    const before = gateway.readStore().calls.length;
    const prep = await client.callTool({ name: "prepare_call", arguments: { to: TARGET, objective: OBJECTIVE } });
    assert.notEqual(prep.isError, true, `prepare_call ueber stdio (stderr: ${stderrOutput})`);
    const code = prep._meta?.[CONFIRMATION_META_KEY];
    assert.match(code, CODE_PATTERN, "stdio bekommt den Code (MCP_UI_ENABLED=true im Kind)");

    const placed = await client.callTool({
      name: "place_call",
      arguments: { to: TARGET, objective: OBJECTIVE, confirmation_code: code },
    });
    assert.notEqual(placed.isError, true, `place_call ueber stdio (stderr: ${stderrOutput})`);
    assert.ok(placed.structuredContent.call_id, "call_id vorhanden");
    assert.equal(gateway.readStore().calls.length, before + 1, "genau EIN Anruf entstanden");
  } finally {
    await client.close();
    await gateway.stop();
  }
});

// ==================== (i) OAuth: echtes Token, fremder Mandant ============================
// Zwei subscriber-Tenants, je ueber ihr eigenes idpSubject aufgeloest (Muster
// profile-tenant-key.test.js subscriberTenant). Tenant A bestaetigt per prepare_call ueber
// SEIN Token; Tenant B versucht mit GENAU diesem Code zu waehlen, ueber SEIN EIGENES Token -
// der Code ist an tenantId gebunden (canonicalCallRequest bindet ihn NICHT an tenantId, aber
// issueConfirmationCode/matchedWindowIndex tun es ueber den HMAC-Input, s. call-confirmation.js)
// und darf fuer B nicht gelten. Diese Bindung war bisher nur indirekt (X-Internal-Tenant
// direkt an der Route) belegt, hier zum ersten Mal ueber ein ECHTES OAuth-Token durch /mcp.
const OAUTH_TARGET = "+4915112340098";
const OAUTH_TENANT_A = "tenant-t2-13-oauth-a";
const OAUTH_TENANT_B = "tenant-t2-13-oauth-b";
const OAUTH_SUB_A = "sub-t2-13-oauth-a";
const OAUTH_SUB_B = "sub-t2-13-oauth-b";

function oauthTenant(id, idpSubject) {
  return { id, status: "active", idpSubject, ownerName: `${id} Tester`, kycLevel: KYC_LEVEL.CARD };
}

// Tenant A braucht ein durchlaessiges Profil UND eine aktive Nummer, damit die
// Gegenprobe (Tenant A waehlt mit seinem EIGENEN Code) bis zur echten Origination
// (FAKE_ORIGINATE) durchlaeuft, statt an einem GATE zu scheitern, das mit der
// Bestaetigung nichts zu tun hat (sonst waere isError=true zweideutig: Bestaetigung
// oder Stundenlimit/Nummer? Muster profile-tenant-key.test.js (a)).
const OAUTH_TENANT_A_NUMBER = "+4915110000077";

test("(i) OAuth (echtes Token, fremder Mandant): Code von Tenant A waehlt nicht fuer Tenant B", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      ALLOWED_COUNTRY_CODES: "*",
      MCP_UI_ENABLED: "true",
      CALL_CONFIRMATION_SECRET: TEST_SECRET,
      MULTI_TENANT: "true",
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
    },
    seed: seedState({
      tenants: [oauthTenant(OAUTH_TENANT_A, OAUTH_SUB_A), oauthTenant(OAUTH_TENANT_B, OAUTH_SUB_B)],
      profiles: {
        [OAUTH_TENANT_A]: planProfileFor("business"),
        [OAUTH_TENANT_B]: planProfileFor("business"),
      },
      numbers: [
        {
          id: "num-t2-13-oauth-a",
          e164: OAUTH_TENANT_A_NUMBER,
          tenantId: OAUTH_TENANT_A,
          provider: "telnyx",
          status: "active",
          providerNumberId: null,
        },
      ],
    }),
  });
  try {
    const before = srv.readStore().calls.length;
    const tokenA = await idp.sign({ sub: OAUTH_SUB_A });
    const tokenB = await idp.sign({ sub: OAUTH_SUB_B });

    const prepRes = await mcpPost(
      `${srv.localUrl}/mcp`,
      tokenA,
      toolCall("prepare_call", { to: OAUTH_TARGET, objective: OBJECTIVE }),
    );
    const prep = await readToolResult(prepRes);
    assert.notEqual(prep.isError, true, "Tenant A: prepare_call ueber OAuth");
    const code = prep._meta[CONFIRMATION_META_KEY];

    const foreignRes = await mcpPost(
      `${srv.localUrl}/mcp`,
      tokenB,
      toolCall("place_call", { to: OAUTH_TARGET, objective: OBJECTIVE, confirmation_code: code }),
    );
    const foreign = await readToolResult(foreignRes);
    assert.equal(foreign.isError, true, "Tenant B darf mit dem Code von Tenant A nicht waehlen");

    // Gegenprobe: derselbe Code fuer Tenant A SELBST funktioniert (der Code ist nicht
    // generell kaputt, nur an den falschen Mandanten gebunden).
    const ownRes = await mcpPost(
      `${srv.localUrl}/mcp`,
      tokenA,
      toolCall("place_call", { to: OAUTH_TARGET, objective: OBJECTIVE, confirmation_code: code }),
    );
    const own = await readToolResult(ownRes);
    assert.notEqual(own.isError, true, "Gegenprobe: Tenant A selbst kann mit seinem Code waehlen");

    assert.equal(srv.readStore().calls.length, before + 1, "genau EIN Anruf (nur Tenant A) entstanden");
  } finally {
    await srv.stop();
    await idp.close();
  }
});
