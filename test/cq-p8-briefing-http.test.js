// P8 (PLAN-CONVERSATION-QUALITY-V2): HTTP-Verdrahtung des Pre-Call-Briefings ueber POST
// /api/calls. Reiner Spawn (startServer), KEIN pglite in derselben Datei (Lehre
// p6a-Stall: NIE mischen). Muster cq-p6-mandate-http.test.js/assistant-context-
// http.test.js: der Owner-Pfad passiert alle Gates und scheitert meist erst am
// Offline-Originate (500) - der Call ist trotzdem persistiert und ueber
// srv.readStore() lesbar. HP1 nutzt zusaetzlich den lokalen Telnyx-TeXML-Voice-Mock
// (Muster assistant-context-http.test.js HC7), um die 200-Erfolgsantwort (inkl.
// context_received) zu erreichen.
//
// Env pro Test: ANTHROPIC_BASE_URL zeigt auf einen lokalen Mock (kein echtes Netz,
// keine echten Kosten), PRECALL_BRIEFING_ENABLED/ASSISTANT_CONTEXT_ENABLED explizit.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer } from "./helpers.js";

const TO = "+4915112345678"; // erlaubtes Ziel, kein Premium/Notruf

// Voll besetzte Briefing-Antwort (vier Kontextfelder, ohne Mandat).
const FULL_BRIEFING_INPUT = Object.freeze({
  summary: "Kunde bittet um Verschiebung des Termins",
  recipient_relationship: "Stammfriseur",
  desired_outcome: "Neuer Termin am Freitagvormittag",
  key_facts: ["Name Mueller"],
});

// Owner-Eingaben fuer HP2/HP5 (D2: Owner-Eingabe gewinnt immer).
const OWNER_CTX = { summary: "Owner-eigener Kontext" };
const OWNER_MANDATE = {
  decide_freely: "Termin an einem Werktag, bis 40 Euro",
  fallback_order: "zuerst Mittwoch, sonst Donnerstag",
  on_out_of_scope: "decline",
};
// Vom (gemockten) Briefing-Modell erfundenes Mandat - HP5 beweist, dass es NICHT
// gewinnt, sobald der Owner selbst ein Mandat mitgeschickt hat.
const BRIEFED_MANDATE_INPUT = Object.freeze({
  ...FULL_BRIEFING_INPUT,
  mandate: Object.freeze({
    decide_freely: "Vom Modell erfundener Spielraum",
    fallback_order: "Vom Modell erfundene Reihenfolge",
    on_out_of_scope: "take_message",
  }),
});

function anthropicToolMessage(input) {
  return {
    id: "msg_p8_http_mock",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [{ type: "tool_use", id: "tu_briefing", name: "hintergrund", input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 40, output_tokens: 30 },
  };
}

// Lokaler Anthropic-Mock: liefert IMMER dieselbe tool_use-Antwort, zaehlt Requests
// (Flag-off/Owner-gewinnt-Beweise brauchen einen Zaehler, keinen Inhalt).
async function startBriefingMock(input = FULL_BRIEFING_INPUT) {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      requestCount += 1;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(anthropicToolMessage(input)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requestCount: () => requestCount,
    close: () => new Promise((r) => server.close(r)),
  };
}

// Lokaler Anthropic-Mock, der IMMER 500 antwortet (HP3: Fail-Soft).
async function startFailingBriefingMock() {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

// Lokaler Telnyx-TeXML-Voice-Mock (Muster assistant-context-http.test.js startVoiceMock):
// Originate liefert {sid} -> deterministischer Weg zu einer 200-Erfolgsantwort ohne
// echten Anruf.
async function startVoiceMock() {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ sid: "tnx_p8_http_mock_1" }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

const TELNYX_OWNER = { e164: "+13125550100", provider: "telnyx" };
const telnyxEnv = (voiceMockUrl, extra = {}) => ({
  TELNYX_API_KEY: "KEYtest-secret",
  TELNYX_CONNECTION_ID: "conn_test",
  TELNYX_ACCOUNT_SID: "acct_test",
  TELNYX_API_BASE: voiceMockUrl,
  ...extra,
});

const BRIEFING_ON = { PRECALL_BRIEFING_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" };

function placeCall(srv, body = {}) {
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: TO, objective: "Termin vereinbaren", ...body }),
  });
}

const outboundCallsTo = (srv) =>
  srv.readStore().calls.filter((c) => c.direction === "outbound" && c.to === TO);

test("HP1 place_call ohne context + Briefing an: persistiert alle vier Kontextfelder, context_received.summary=true", async () => {
  const voiceMock = await startVoiceMock();
  const anthropicMock = await startBriefingMock();
  const srv = await startServer({
    env: telnyxEnv(voiceMock.url, { ANTHROPIC_BASE_URL: anthropicMock.url, ...BRIEFING_ON }),
    ownerNumber: TELNYX_OWNER,
  });
  try {
    const res = await placeCall(srv);
    assert.equal(res.status, 200, "Originate ueber den Voice-Mock erfolgreich");
    const json = await res.json();
    assert.equal(json.context_received.summary, true, "Abnahme (a): gebriefter Kontext kommt an");
    const calls = outboundCallsTo(srv);
    assert.equal(calls.length, 1, "genau ein Call erzeugt");
    assert.deepEqual(calls[0].context, FULL_BRIEFING_INPUT, "voller gebriefter Kontext persistiert");
  } finally {
    await srv.stop();
    await voiceMock.close();
    await anthropicMock.close();
  }
});

test("HP2 place_call MIT Owner-context: Mock-Request-Zaehler bleibt 0, persistierter Kontext == Owner-Eingabe (D2)", async () => {
  const anthropicMock = await startBriefingMock();
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: anthropicMock.url, ...BRIEFING_ON },
  });
  try {
    const res = await placeCall(srv, { context: OWNER_CTX });
    assert.equal(res.status, 500, "Owner passiert alle Gates, scheitert erst am Offline-Originate");
    const calls = outboundCallsTo(srv);
    assert.equal(calls.length, 1, "genau ein Call erzeugt");
    assert.deepEqual(calls[0].context, OWNER_CTX, "Owner-Kontext bleibt unangetastet");
    assert.equal(anthropicMock.requestCount(), 0, "Owner-Kontext gewinnt -> kein Briefing-Request (D2)");
  } finally {
    await srv.stop();
    await anthropicMock.close();
  }
});

test("HP3 Briefing-Mock antwortet 500: Call wird trotzdem angelegt, context===null, mandate===null (Fail-Soft)", async () => {
  const anthropicMock = await startFailingBriefingMock();
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: anthropicMock.url, ...BRIEFING_ON },
  });
  try {
    const res = await placeCall(srv);
    assert.equal(res.status, 500, "Offline-Originate scheitert weiterhin (kein Netz zum echten Provider)");
    const calls = outboundCallsTo(srv);
    assert.equal(calls.length, 1, "Anruf wird trotz gescheitertem Briefing nicht blockiert");
    assert.equal(calls[0].context, null, "kein Kontext bei gescheitertem Briefing");
    assert.equal(calls[0].mandate, null, "kein Mandat bei gescheitertem Briefing");
  } finally {
    await srv.stop();
    await anthropicMock.close();
  }
});

test("HP4 Flag PRECALL_BRIEFING_ENABLED aus: Mock-Zaehler 0, context===null (byte-identisches Bestandsverhalten)", async () => {
  const anthropicMock = await startBriefingMock();
  const srv = await startServer({
    // PRECALL_BRIEFING_ENABLED bleibt auf dem BASE_ENV-Default "false".
    env: { ANTHROPIC_BASE_URL: anthropicMock.url, ASSISTANT_CONTEXT_ENABLED: "true" },
  });
  try {
    const res = await placeCall(srv);
    assert.equal(res.status, 500);
    const calls = outboundCallsTo(srv);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].context, null);
    assert.equal(anthropicMock.requestCount(), 0, "Flag aus -> kein Briefing-Request (0 Kosten)");
  } finally {
    await srv.stop();
    await anthropicMock.close();
  }
});

test("HP5 Owner-mandate + Briefing liefert eigenes Mandat: persistiert wird das Owner-Mandat (D2)", async () => {
  const anthropicMock = await startBriefingMock(BRIEFED_MANDATE_INPUT);
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: anthropicMock.url, ...BRIEFING_ON },
  });
  try {
    const res = await placeCall(srv, { mandate: OWNER_MANDATE });
    assert.equal(res.status, 500, "Owner passiert alle Gates, scheitert erst am Offline-Originate");
    const calls = outboundCallsTo(srv);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].mandate, OWNER_MANDATE, "Owner-Mandat gewinnt ueber das gebriefte Mandat");
    assert.deepEqual(
      calls[0].context,
      FULL_BRIEFING_INPUT,
      "Kontext kommt trotzdem vom Briefing (der Owner gab keinen context mit)",
    );
  } finally {
    await srv.stop();
    await anthropicMock.close();
  }
});
