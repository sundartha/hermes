// T2-09 (O-13 Datenminimierung, O-20 kein Abo-/Upgrade-Flow): neutrale, sprachabhaengige
// Fehlertexte an der MCP-Grenze. Testname traegt KEIN Katalog-Praefix (Lehre
// catalog-id-prefix-misroutes-tests) - laeuft in npm test, nicht im Gates-Lauf.
//
// T1: Vollstaendigkeit der Ablehnungs-Textabelle GEGEN DIE QUELLE (outbound-gates.js),
// nicht gegen eine gepflegte Liste - ein neuer Gate-Grund faellt sonst STUMM auf
// DENIAL_UNKNOWN (Pre-Mortem 2), ohne dass ein Test das je merkt.
// T2: Reinheit jedes Tabellentexts (kein Env-Name, keine Zahl, kein Abo-/Upgrade-Wort,
// kein "HTTP <n>"/"fetch failed", EN/FR ohne deutsches Signalwort).
// T3: Draht HTTP /mcp, Legacy/Bootstrap - echter tools/call gegen einen echten Server.
// T5: Draht stdio, echter Kindprozess (src/mcp-server.js) + Gateway-Attrappe (Muster
// test/openai-p5b-geldpfad.test.js Fall C) - deckt (a) 402 minutes, (b) 403 frozen ohne
// den Env-Namen, (c) unbekannter Grund -> DENIAL_UNKNOWN + Server-Warnung, (d) Gateway
// unerreichbar ohne "fetch failed", (e) 500 ohne Body ohne "HTTP 500", (f) 400-Eingabefehler
// ohne reason bleibt durchgereicht (Entscheidung 3), (g) list_action_items ohne interne ID.
// T4 (OAuth, Nicht-Bootstrap-Tenant): NICHT gebaut - s. Bericht (UNKNOWN mit Grund). T5(a)
// deckt den 402-Minuten-Fall am Draht bereits, S1 deckt das REST-reason-Feld separat mit
// einer echten PAYMENT_ENABLED/b2-Fixture ab.
// T6: HTTP-Statusklassen ohne bekannten Grund (404/403/409-ausserhalb-answer_consult).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerTools } from "../src/mcp-tools.js";
import { MCP_TEXTS, MCP_ERROR_CODE } from "../src/i18n/mcp-texts.js";
import { MCP_DENIAL_TEXTS } from "../src/i18n/mcp-denial-texts.js";
import { SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";
import { startServer, mcpPost, toolCall, readToolResult, ROOT, BASE_ENV } from "./helpers.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FROZEN = 403;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_SERVER_ERROR = 500;
const OUTBOUND_GATES_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../src/telephony/outbound-gates.js");
const MINUTES_TEXT_MIN_COUNT = 20; // Positiv-Kontrolle T1: >= 20 Gruende in der Quelle

// ==================== T1: Vollstaendigkeit gegen die Quelle ====================

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

// STRUKTUR-Waechter: das erste Argument JEDES denialAudit(-Aufrufs ist ein String-Literal,
// GATE_ERROR_GRUND, "grund" oder "<bezeichner>.grund" - sonst faellt ein neuer, indirekter
// Grund-Lieferant durch das Netz der obigen Regex-Extraktion, ohne dass ein Test es merkt.
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

  // Positiv-Kontrolle: das Kommando findet tatsaechlich etwas.
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

// ==================== T2: Reinheit ====================

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

test("T2: jeder Ablehnungstext und die vier neuen Fehlertexte sind neutral (alle Sprachen)", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    for (const [grund, txt] of Object.entries(MCP_DENIAL_TEXTS[lang]))
      assertNeutralText(txt, `${lang}.denials.${grund}`);
    for (const code of [
      MCP_ERROR_CODE.DENIAL_UNKNOWN,
      MCP_ERROR_CODE.NOT_FOUND,
      MCP_ERROR_CODE.NOT_PERMITTED,
      MCP_ERROR_CODE.REQUEST_REJECTED,
    ])
      assertNeutralText(MCP_TEXTS[lang].errors[code], `${lang}.errors.${code}`);
  }
  for (const lang of ["en", "fr"]) {
    for (const [grund, txt] of Object.entries(MCP_DENIAL_TEXTS[lang]))
      assert.doesNotMatch(txt, GERMAN_SIGNAL_WORDS, `${lang}.denials.${grund}: deutsches Signalwort`);
  }
});

// ==================== T3: Draht HTTP /mcp, Legacy/Bootstrap ====================

test("T3 (Draht HTTP /mcp, Legacy/Bootstrap): OUTBOUND_FROZEN liefert den neutralen Text, kein Env-Name", async () => {
  const srv = await startServer({ env: { OUTBOUND_FROZEN: "true" } });
  try {
    const before = srv.readStore().calls.length;
    const res = await mcpPost(
      `${srv.localUrl}/mcp`,
      null,
      toolCall("place_call", { to: "+4915112345678", objective: "Termin vereinbaren" }),
    );
    const result = await readToolResult(res);
    assert.equal(result.isError, true, "frozen ist ein Fehlerergebnis");
    const text = result.content[0].text;
    assert.equal(text, MCP_TEXTS.en.denials.frozen, "Bootstrap/Legacy faellt auf den Weltdefault en");
    assert.doesNotMatch(text, /OUTBOUND_FROZEN/, "kein Env-Name im Tool-Text");
    assert.equal(srv.readStore().calls.length, before, "kein Call entstanden");

    // Gegenprobe: /api/calls direkt liefert weiterhin den Bestandstext MIT OUTBOUND_FROZEN
    // (REST-error-Text bleibt unveraendert, nur die MCP-Kante wird neutral).
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

// ==================== S1: additives REST-reason-Feld (Formfehler bleibt ohne reason) ====================

test("S1 (REST): ein reiner 400-Formfehler (fehlendes Pflichtfeld) traegt KEIN reason-Feld", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "+4915112345678" }), // objective fehlt -> Formfehler, kein Gate
    });
    assert.equal(res.status, HTTP_BAD_REQUEST);
    const body = await res.json();
    assert.equal("reason" in body, false, "ein reiner Eingabefehler traegt kein audit-Objekt, also kein reason");
  } finally {
    await srv.stop();
  }
});

// ==================== T5: Draht stdio, echter Kindprozess + Gateway-Attrappe ====================

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

// EIN Gateway-Attrappe-Server fuer (a)(b)(c)(e)(f)(g): POST /api/calls antwortet der
// Reihe nach aus der Warteschlange, GET /api/state liefert IMMER den Action-Item-Seed
// (unabhaengig von der Warteschlange - list_action_items verbraucht sie nicht).
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
    // GATEWAY_URL NUR diesem Kindprozess mitgeben, NICHT in BASE_ENV (sonst leakt es in
    // jeden anderen Spawn-Test, Lehre test-base-env-drift).
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
    // (a) 402 minutes -> MCP_TEXTS.en.denials.minutes
    {
      status: HTTP_PAYMENT_REQUIRED,
      body: {
        error: "Inkludierte Plan-Minuten aufgebraucht. Bitte Tarif anpassen oder neue Abrechnungsperiode abwarten.",
        reason: "minutes",
      },
    },
    // (b) 403 frozen -> kein OUTBOUND_FROZEN im Text
    {
      status: HTTP_FROZEN,
      body: { error: "Outbound-Anrufe sind derzeit gesperrt (OUTBOUND_FROZEN).", reason: "frozen" },
    },
    // (c) unbekannter/kuenftiger Grund -> DENIAL_UNKNOWN + Server-Warnung
    { status: HTTP_PAYMENT_REQUIRED, body: { reason: "voellig_neu" } },
    // (e) 500 ohne Body -> kein "HTTP 500"
    { status: HTTP_SERVER_ERROR },
    // (f) reiner 400-Eingabefehler ohne reason -> Text wird durchgereicht (Entscheidung 3)
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

      // (a) 402 minutes
      const minutesResult = await place();
      assert.equal(minutesResult.isError, true);
      assert.equal(minutesResult.content[0].text, MCP_TEXTS.en.denials.minutes);

      // (b) 403 frozen, kein Env-Name
      const frozenResult = await place();
      assert.equal(frozenResult.isError, true);
      assert.doesNotMatch(frozenResult.content[0].text, /OUTBOUND_FROZEN/);

      // (c) unbekannter/kuenftiger Grund
      const unknownResult = await place();
      assert.equal(unknownResult.isError, true);
      assert.equal(unknownResult.content[0].text, MCP_TEXTS.en.errors[MCP_ERROR_CODE.DENIAL_UNKNOWN]);
      assert.match(
        stderrOf(),
        /unbekannter Ablehnungsgrund.*voellig_neu/,
        "die bereinigte, unbekannte Kennung landet im Server-Log (stderr), nicht beim Client",
      );

      // (e) 500 ohne Body
      const serverErrorResult = await place();
      assert.equal(serverErrorResult.isError, true);
      assert.doesNotMatch(serverErrorResult.content[0].text, /HTTP 500/);

      // (f) reiner 400-Eingabefehler ohne reason -> Text wird durchgereicht
      const inputHintResult = await place();
      assert.equal(inputHintResult.isError, true);
      assert.equal(inputHintResult.content[0].text, "objective ist zu lang (max. 300 Zeichen).");

      // (g) list_action_items: die interne ID darf im Text nicht auftauchen, der Text
      // selbst schon (Positiv-Kontrolle).
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
  // Port 1 ist auf jeder Testumgebung als privilegierter, ungebundener Port unerreichbar -
  // derselbe Trick wie test/openai-p5b-geldpfad.test.js fuer den Netzfehler-Fall.
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

// ==================== T6: HTTP-Statusklassen ohne bekannten Grund ====================

// Lokaler Mini-Harness (Muster test/inbox-mcp-tool.test.js): registerTools gegen eine
// Fake-server-Attrappe, GATEWAY_URL zeigt auf eine lokale Gegenstelle mit fester Antwort.
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

async function withFixedGateway(response, run) {
  const server = http.createServer((req, res) => sendJson(res, response));
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
