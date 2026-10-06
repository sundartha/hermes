import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerTools, toolErrorText } from "../src/mcp-tools.js";
import { MCP_TEXTS, MCP_ERROR_CODE } from "../src/i18n/mcp-texts.js";
import { MCP_DENIAL_TEXTS } from "../src/i18n/mcp-denial-texts.js";
import { SUPPORTED_LANGUAGES, localeFor } from "../src/i18n/locales.js";
import { startServer, startIdp, mcpPost, toolCall, readToolResult, ROOT, BASE_ENV, PLAN_PRICE_BOOT_ENV } from "./helpers.js";
import { makeDefaultState, settingsFor } from "../src/store/state-ops.js";
import { USAGE_EVENT_KIND } from "../src/store/defaults.js";
import { findPlan } from "../src/plans.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FROZEN = 403;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_SERVER_ERROR = 500;
const OUTBOUND_GATES_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../src/telephony/outbound-gates.js");
const MINUTES_TEXT_MIN_COUNT = 20;

function readOutboundGatesSource() {
  return readFileSync(OUTBOUND_GATES_PATH, "utf8");
}

function grundSetFromSource(src) {
  const literal = [...src.matchAll(/grund:\s*"([a-z_]+)"/g)].map((match) => match[1]);
  const auditLiteral = [...src.matchAll(/denialAudit\(\s*"([a-z_]+)"/g)].map((match) => match[1]);
  const gateErrorMatch = src.match(/export const GATE_ERROR_GRUND = "([a-z_]+)";/);
  assert.ok(gateErrorMatch, "GATE_ERROR_GRUND muss als String-Literal exportiert sein");
  return new Set([...literal, ...auditLiteral, gateErrorMatch[1]]);
}

function assertDenialAuditCallsAreStructured(src) {
  const calls = [...src.matchAll(/denialAudit\(\s*([^,]+),/g)].map((match) => match[1].trim());
  assert.ok(calls.length >= 1, "Positiv-Kontrolle: mindestens ein denialAudit-Aufruf gefunden");
  for (const arg of calls) {
    const ok =
      /^"[a-z_]+"$/.test(arg) ||
      arg === "GATE_ERROR_GRUND" ||
      arg === "grund" ||
      /^[A-Za-z_][A-Za-z0-9_]*\.grund$/.test(arg);
    assert.ok(ok, `denialAudit-Aufruf mit unerwartetem ersten Argument: ${arg}`);
  }
}

test("T1: jeder Ablehnungsgrund aus outbound-gates.js hat in JEDER Sprache genau einen Tabelleneintrag", () => {
  const src = readOutboundGatesSource();
  assertDenialAuditCallsAreStructured(src);
  const quelle = grundSetFromSource(src);

  for (const bekannt of ["minutes", "frozen", "gate_error", "reserve_error"]) {
    assert.ok(quelle.has(bekannt), `Positiv-Kontrolle: "${bekannt}" muss in der Quelle stehen`);
  }
  assert.ok(
    quelle.size >= MINUTES_TEXT_MIN_COUNT,
    `Positiv-Kontrolle: >= ${MINUTES_TEXT_MIN_COUNT} Gruende erwartet, gefunden ${quelle.size}`,
  );

  for (const lang of SUPPORTED_LANGUAGES) {
    const tabelle = new Set(Object.keys(MCP_TEXTS[lang].denials));
    for (const grund of quelle)
      assert.ok(tabelle.has(grund), `${lang}: Grund "${grund}" aus der Quelle fehlt in der Tabelle`);
    for (const grund of tabelle)
      assert.ok(quelle.has(grund), `${lang}: toter Tabellen-Eintrag "${grund}" (nicht in der Quelle)`);
  }
});

const FORBIDDEN_WORDS =
  /tarif|upgrade|\bplans?\b|pricing|price|preis|\babo\b|abonn|subscri|forfait/i;
const ENV_NAME_PATTERN = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;
const HTTP_LEAK_PATTERN = /HTTP \d{3}|fetch failed/;
const GERMAN_SIGNAL_WORDS = /\b(Anruf|nicht|bitte|gesperrt|Konto)\b/i;

function assertNeutralText(text, label) {
  assert.ok(text && text.trim().length > 0, `${label}: darf nicht leer sein`);
  assert.doesNotMatch(text, FORBIDDEN_WORDS, `${label}: Abo-/Upgrade-Wort gefunden`);
  assert.doesNotMatch(text, ENV_NAME_PATTERN, `${label}: sieht wie ein Env-Name aus`);
  assert.doesNotMatch(text, HTTP_LEAK_PATTERN, `${label}: roher HTTP-/Netzwerk-Leak`);
  assert.doesNotMatch(text, /\d/, `${label}: enthaelt eine Ziffer`);
}

test("T2: jeder Ablehnungstext und die fuenf neuen Fehlertexte sind neutral (alle Sprachen)", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    for (const [grund, txt] of Object.entries(MCP_DENIAL_TEXTS[lang]))
      assertNeutralText(txt, `${lang}.denials.${grund}`);
    for (const code of [
      MCP_ERROR_CODE.DENIAL_UNKNOWN,
      MCP_ERROR_CODE.NOT_FOUND,
      MCP_ERROR_CODE.NOT_PERMITTED,
      MCP_ERROR_CODE.REQUEST_REJECTED,
      MCP_ERROR_CODE.CALL_START_REJECTED,
    ])
      assertNeutralText(MCP_TEXTS[lang].errors[code], `${lang}.errors.${code}`);
  }
  for (const lang of ["en", "fr"]) {
    for (const [grund, txt] of Object.entries(MCP_DENIAL_TEXTS[lang]))
      assert.doesNotMatch(txt, GERMAN_SIGNAL_WORDS, `${lang}.denials.${grund}: deutsches Signalwort`);
  }
});

const TEST_CONFIRMATION_SECRET = "t2-09-test-secret-mindestens-32-zeichen-lang";
async function confirmedPlaceCallArgs(localUrl, args, tenantHeader = null) {
  const res = await fetch(`${localUrl}/api/call-confirmations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(tenantHeader ? { "X-Internal-Tenant": tenantHeader } : {}),
    },
    body: JSON.stringify(args),
  });
  const json = await res.json();
  return { ...args, confirmation_code: json.confirmation?.code };
}

test("T3 (Draht HTTP /mcp, Legacy/Bootstrap): OUTBOUND_FROZEN liefert den neutralen Text, kein Env-Name", async () => {
  const srv = await startServer({
    env: { OUTBOUND_FROZEN: "true", CALL_CONFIRMATION_SECRET: TEST_CONFIRMATION_SECRET },
  });
  try {
    const before = srv.readStore().calls.length;
    const placeCallArgs = await confirmedPlaceCallArgs(srv.localUrl, {
      to: "+4915112345678",
      objective: "Termin vereinbaren",
    });
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("place_call", placeCallArgs));
    const result = await readToolResult(res);
    assert.equal(result.isError, true, "frozen ist ein Fehlerergebnis");
    const text = result.content[0].text;
    assert.equal(text, MCP_TEXTS.en.denials.frozen, "Bootstrap/Legacy faellt auf den Weltdefault en");
    assert.doesNotMatch(text, /OUTBOUND_FROZEN/, "kein Env-Name im Tool-Text");
    assert.equal(srv.readStore().calls.length, before, "kein Call entstanden");

    const apiRes = await fetch(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "+4915112345678", objective: "Termin vereinbaren" }),
    });
    assert.equal(apiRes.status, HTTP_FROZEN);
    const apiBody = await apiRes.json();
    assert.match(apiBody.error, /OUTBOUND_FROZEN/, "REST-error bleibt wie im Bestand");
    assert.equal(apiBody.reason, "frozen", "REST traegt additiv den Grund");
    assert.equal(srv.readStore().calls.length, before, "auch die direkte REST-Ablehnung erzeugt keinen Call");
  } finally {
    await srv.stop();
  }
});

const T4_TARGET = "+4915112345678";
const T4_TENANT = "tenant-t2-09-oauth";
const T4_SUB = "sub-t2-09-oauth";
const T4_NUMBER = "+4915110000099";
const T4_SECONDS_PER_DAY = 86400;
const T4_MS_PER_SECOND = 1000;
const T4_PERIOD_START_DAYS_AGO = 5;
const T4_PERIOD_START_SEC =
  Math.floor(Date.now() / T4_MS_PER_SECOND) - T4_PERIOD_START_DAYS_AGO * T4_SECONDS_PER_DAY;
const T4_STARTER_MIN = findPlan("starter").includedMinutes;

function t4MinutesExhaustedSeed() {
  const state = makeDefaultState();
  state.tenants.push({
    id: T4_TENANT,
    status: "active",
    idpSubject: T4_SUB,
    ownerName: "T2-09 OAuth Tenant",
    kycLevel: "card",
    stripePlanSlug: "starter",
    stripeCurrentPeriodStart: T4_PERIOD_START_SEC,
  });
  state.numbers.push({
    id: "num_t4_oauth",
    e164: T4_NUMBER,
    tenantId: T4_TENANT,
    provider: "telnyx",
    status: "active",
    providerNumberId: null,
  });
  state.profiles[T4_TENANT] = { maxCallsPerHour: null };
  state.usageEvents.push({
    id: "ue_t4_oauth",
    tenantId: T4_TENANT,
    callId: null,
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: T4_STARTER_MIN,
    costCents: 0,
    occurredAt: new Date().toISOString(),
    stripeMeterSent: false,
  });
  settingsFor(state, T4_TENANT).language = "en";
  return state;
}

test("T4 (Draht HTTP /mcp, OAuth, echtes Minuten-Gate): erschoepfte Plan-Minuten -> isError mit dem Tabellentext, REST 402 reason=minutes, kein Call", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      ...PLAN_PRICE_BOOT_ENV,
      MULTI_TENANT: "true",
      PAYMENT_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_x",
      STRIPE_WEBHOOK_SECRET: "whsec_test_x",
      STRIPE_API_BASE: "http://127.0.0.1:9",
      NUMBER_SETUP_FEE_CENTS: "500",
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      CALL_CONFIRMATION_SECRET: TEST_CONFIRMATION_SECRET,
    },
    seed: t4MinutesExhaustedSeed(),
  });
  try {
    const before = srv.readStore().calls.length;
    const token = await idp.sign({ sub: T4_SUB });
    const placeCallArgs = await confirmedPlaceCallArgs(
      srv.localUrl,
      { to: T4_TARGET, objective: "Termin vereinbaren" },
      T4_TENANT,
    );
    const res = await mcpPost(`${srv.localUrl}/mcp`, token, toolCall("place_call", placeCallArgs));
    const result = await readToolResult(res);
    assert.equal(result.isError, true, "erschoepfte Minuten -> Fehlerergebnis");
    assert.equal(
      result.content[0].text,
      MCP_TEXTS.en.denials.minutes,
      "Wortlaut-Pin gegen den Tabellentext (Tenant-Sprache=en, deterministisch gesetzt)",
    );
    assert.equal(srv.readStore().calls.length, before, "kein Call entstanden");

    const apiRes = await fetch(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Internal-Identity": T4_SUB },
      body: JSON.stringify({ to: T4_TARGET, objective: "Termin vereinbaren" }),
    });
    assert.equal(apiRes.status, HTTP_PAYMENT_REQUIRED);
    const apiBody = await apiRes.json();
    assert.equal(apiBody.reason, "minutes", "REST traegt additiv den Grund");
    assert.equal(
      srv.readStore().calls.length,
      before,
      "auch die direkte REST-Ablehnung erzeugt keinen Call",
    );
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("S1 (REST): ein reiner 400-Formfehler (fehlendes Pflichtfeld) traegt KEIN reason-Feld", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "+4915112345678" }),
    });
    assert.equal(res.status, HTTP_BAD_REQUEST);
    const body = await res.json();
    assert.equal("reason" in body, false, "ein reiner Eingabefehler traegt kein audit-Objekt, also kein reason");
  } finally {
    await srv.stop();
  }
});

function sendJson(res, { status = HTTP_OK, body = undefined } = {}) {
  if (body === undefined) {
    res.writeHead(status);
    return res.end();
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const ACTION_ITEM_ID = "ai_internal_secret_123";
const ACTION_ITEM_TEXT = "Rueckruf wegen Termin";

function makeSequentialGateway(placeCallResponses) {
  let i = 0;
  return http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (req.method === "GET" && req.url.startsWith("/api/state")) {
        return sendJson(res, {
          body: { actionItems: [{ id: ACTION_ITEM_ID, done: false, text: ACTION_ITEM_TEXT }] },
        });
      }
      const next = placeCallResponses[i];
      i += 1;
      assert.ok(next, `Gateway-Attrappe: kein weiterer canned response fuer Aufruf ${i} (${req.url})`);
      sendJson(res, next);
    });
  });
}

async function withStdioClient(gatewayUrl, run) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/mcp-server.js"],
    cwd: ROOT,
    env: { ...BASE_ENV, GATEWAY_URL: gatewayUrl },
    stderr: "pipe",
  });
  let stderrOutput = "";
  transport.stderr?.on("data", (chunk) => (stderrOutput += chunk.toString()));
  const client = new Client({ name: "hermes-t2-09-stdio-client", version: "0.0.0" });
  try {
    await client.connect(transport);
    return await run(client, () => stderrOutput);
  } finally {
    await client.close();
  }
}

test("T5 (Draht stdio, echter Kindprozess): Gate-Grund, unbekannter Grund, Netzfehler, 500, 400-Durchreichung, Item-ID", async () => {
  const responses = [
    {
      status: HTTP_PAYMENT_REQUIRED,
      body: {
        error: "Inkludierte Plan-Minuten aufgebraucht. Bitte Tarif anpassen oder neue Abrechnungsperiode abwarten.",
        reason: "minutes",
      },
    },
    {
      status: HTTP_FROZEN,
      body: { error: "Outbound-Anrufe sind derzeit gesperrt (OUTBOUND_FROZEN).", reason: "frozen" },
    },
    { status: HTTP_PAYMENT_REQUIRED, body: { reason: "voellig_neu" } },
    { status: HTTP_SERVER_ERROR },
    { status: HTTP_BAD_REQUEST, body: { error: "objective ist zu lang (max. 300 Zeichen)." } },
  ];
  const server = makeSequentialGateway(responses);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const gatewayUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await withStdioClient(gatewayUrl, async (client, stderrOf) => {
      const place = () =>
        client.callTool({
          name: "place_call",
          arguments: { to: "+4915112345678", objective: "Termin vereinbaren" },
        });

      const minutesResult = await place();
      assert.equal(minutesResult.isError, true);
      assert.equal(minutesResult.content[0].text, MCP_TEXTS.en.denials.minutes);

      const frozenResult = await place();
      assert.equal(frozenResult.isError, true);
      assert.doesNotMatch(frozenResult.content[0].text, /OUTBOUND_FROZEN/);

      const unknownResult = await place();
      assert.equal(unknownResult.isError, true);
      assert.equal(unknownResult.content[0].text, MCP_TEXTS.en.errors[MCP_ERROR_CODE.DENIAL_UNKNOWN]);
      assert.match(
        stderrOf(),
        /unbekannter Ablehnungsgrund.*voellig_neu/,
        "die bereinigte, unbekannte Kennung landet im Server-Log (stderr), nicht beim Client",
      );

      const serverErrorResult = await place();
      assert.equal(serverErrorResult.isError, true);
      assert.doesNotMatch(serverErrorResult.content[0].text, /HTTP 500/);

      const inputHintResult = await place();
      assert.equal(inputHintResult.isError, true);
      assert.equal(inputHintResult.content[0].text, "objective ist zu lang (max. 300 Zeichen).");

      const actionItemsResult = await client.callTool({ name: "list_action_items", arguments: {} });
      assert.equal(actionItemsResult.isError, undefined);
      const actionItemsText = actionItemsResult.content[0].text;
      assert.ok(!actionItemsText.includes(ACTION_ITEM_ID), "keine interne Item-ID im Text");
      assert.ok(!actionItemsText.includes("["), "kein Klammer-Praefix mehr vor dem Item-Text");
      assert.ok(
        actionItemsText.includes(ACTION_ITEM_TEXT),
        "Positiv-Kontrolle: der Item-Text bleibt sichtbar",
      );
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("T5 (Draht stdio, (d) Gateway unerreichbar): kein 'fetch failed' im Client-Text", async () => {
  await withStdioClient("http://127.0.0.1:1", async (client) => {
    const result = await client.callTool({
      name: "place_call",
      arguments: { to: "+4915112345678", objective: "Termin vereinbaren" },
    });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, MCP_TEXTS.en.errors[MCP_ERROR_CODE.UPSTREAM_UNREACHABLE]);
    assert.doesNotMatch(result.content[0].text, /fetch failed/);
  });
});

function captureTools(ctx) {
  const handlers = new Map();
  const fakeServer = {
    tool(...args) {
      const [name, , , handler] = args;
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

const CONFIRMATION_STUB_RESPONSE = {
  status: 200,
  body: { preview: { status: "awaiting_confirmation", to: "+4915112345678", objective: "x" }, confirmed: true },
};

async function withFixedGateway(response, run) {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/call-confirmations") return sendJson(res, CONFIRMATION_STUB_RESPONSE);
    return sendJson(res, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    await run();
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await new Promise((resolve) => server.close(resolve));
  }
}

test("T6: 404 -> NOT_FOUND, 403 ohne reason -> NOT_PERMITTED, 409 ausserhalb answer_consult -> REQUEST_REJECTED", async () => {
  const NOT_FOUND = 404;
  const NOT_PERMITTED = 403;
  const CONFLICT = 409;
  for (const lang of SUPPORTED_LANGUAGES) {
    await withFixedGateway({ status: NOT_FOUND, body: { error: "nicht gefunden" } }, async () => {
      const handlers = captureTools({ language: lang });
      const result = await handlers.get("get_call_status")({ call_id: "does-not-exist" });
      assert.equal(result.isError, true);
      assert.equal(result.content[0].text, MCP_TEXTS[lang].errors[MCP_ERROR_CODE.NOT_FOUND]);
    });
    await withFixedGateway({ status: NOT_PERMITTED, body: { error: "verboten" } }, async () => {
      const handlers = captureTools({ language: lang });
      const result = await handlers.get("get_call_status")({ call_id: "x" });
      assert.equal(result.isError, true);
      assert.equal(result.content[0].text, MCP_TEXTS[lang].errors[MCP_ERROR_CODE.NOT_PERMITTED]);
    });
    await withFixedGateway({ status: CONFLICT, body: { error: "konflikt" } }, async () => {
      const handlers = captureTools({ language: lang });
      const result = await handlers.get("get_call_status")({ call_id: "x" });
      assert.equal(result.isError, true);
      assert.equal(result.content[0].text, MCP_TEXTS[lang].errors[MCP_ERROR_CODE.REQUEST_REJECTED]);
    });
  }
});

const PROVIDER_REJECTED_STATUS = 502;
const ORIGINATE_FAILED_STATUS = 500;
const GATE_ERROR_STATUS = 503;
const NO_RETRY_INVITATION = /try again|erneut versuchen|réessayer/i;

test("T7 (Draht, lokaler Harness): place_call-5xx ohne reason -> CALL_START_REJECTED, verweist auf list_calls statt auf sofortiges Wiederholen", async () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    for (const status of [ORIGINATE_FAILED_STATUS, PROVIDER_REJECTED_STATUS]) {
      await withFixedGateway(
        { status, body: { error: "Provider hat den Anruf abgelehnt (HTTP 502)." } },
        async () => {
          const handlers = captureTools({ language: lang });
          const result = await handlers.get("place_call")({
            to: "+4915112345678",
            objective: "Termin vereinbaren",
          });
          assert.equal(result.isError, true, `status=${status}`);
          const text = result.content[0].text;
          assert.equal(text, MCP_TEXTS[lang].errors[MCP_ERROR_CODE.CALL_START_REJECTED], `status=${status}`);
          assertNeutralText(text, `${lang}.CALL_START_REJECTED (status=${status})`);
          assert.doesNotMatch(
            text,
            NO_RETRY_INVITATION,
            `${lang}.CALL_START_REJECTED (status=${status}): laedt nicht zum sofortigen Wiederholen ein`,
          );
        },
      );
    }
    await withFixedGateway(
      { status: GATE_ERROR_STATUS, body: { error: "Sicherheitspruefung nicht abgeschlossen.", reason: "gate_error" } },
      async () => {
        const handlers = captureTools({ language: lang });
        const result = await handlers.get("place_call")({
          to: "+4915112345678",
          objective: "Termin vereinbaren",
        });
        assert.equal(result.isError, true);
        assert.equal(result.content[0].text, MCP_TEXTS[lang].denials.gate_error);
      },
    );
  }
});

const UNREACHABLE_GATEWAY_URL = "http://127.0.0.1:1";
const LAST_RESORT_TEXT = MCP_TEXTS.en.errors[MCP_ERROR_CODE.UPSTREAM_UNREACHABLE];
const NETWORK_ERROR = new TypeError("fetch failed");

async function networkErrorText(ctx) {
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = UNREACHABLE_GATEWAY_URL;
  try {
    const result = await captureTools(ctx).get("get_agent_number")();
    assert.equal(result.isError, true);
    return result.content[0].text;
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
  }
}

test("T8a: Netzwerkfehler folgt der Tenant-Sprache, fehlende/unbekannte Sprache faellt auf den Weltdefault", async () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const text = await networkErrorText({ language: lang });
    assert.equal(text, MCP_TEXTS[lang].errors[MCP_ERROR_CODE.UPSTREAM_UNREACHABLE], lang);
    assertNeutralText(text, `${lang}.UPSTREAM_UNREACHABLE`);
  }
  const worldDefaultText = localeFor(undefined).mcp.errors[MCP_ERROR_CODE.UPSTREAM_UNREACHABLE];
  for (const language of [undefined, "xx"]) {
    const text = await networkErrorText({ language });
    assert.equal(text, worldDefaultText, `language=${language}`);
    assertNeutralText(text, `language=${language}`);
  }
});

test("T8b: fehlende Uebersetzung oder fehlendes Text-Buendel -> neutraler EN-Rueckfall, kein Wurf", () => {
  const missingCode = { errors: { ...MCP_TEXTS.de.errors, [MCP_ERROR_CODE.UPSTREAM_UNREACHABLE]: undefined } };
  const emptyText = { errors: { [MCP_ERROR_CODE.UPSTREAM_UNREACHABLE]: "  " }, denials: {} };
  for (const [label, texts] of [
    ["kein Buendel", undefined],
    ["leeres Buendel", {}],
    ["fehlender Code", missingCode],
    ["leerer Text", emptyText],
  ]) {
    const text = toolErrorText(NETWORK_ERROR, texts);
    assert.equal(text, LAST_RESORT_TEXT, label);
    assertNeutralText(text, label);
  }
  assert.equal(toolErrorText({ reason: "frozen" }, undefined), LAST_RESORT_TEXT);
});
