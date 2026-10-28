import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { MCP_HOP_TIMEOUT_MS, PLACE_CALL_HOP_TIMEOUT_MS } from "../src/mcp-tools.js";
import { MCP_TEXTS, MCP_ERROR_CODE } from "../src/i18n/mcp-texts.js";
import { CONSULT_EVENT, CONSULT_POLL_ABORT_MS } from "../src/consult/delivery.js";
import { config } from "../src/config.js";
import { captureToolHandlers } from "./gemeinsam/werkzeug-registrierung.js";
import {
  EL_TERMINATION_RESULT_ATTEMPTS,
  EL_ABORT_PROVIDER_TIMEOUT_MS,
} from "../src/elevenlabs/outbound.js";

const HTTP_OK = 200;
const pendingAborts = new Set();
let gateway;
before(async () => {
  gateway = http.createServer((req, res) => {
    if (req.url === "/api/call-confirmations") {
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      return res.end(JSON.stringify({ preview: {}, confirmed: true }));
    }
    req.resume();
    for (const abort of pendingAborts) abort();
    pendingAborts.clear();
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  process.env.GATEWAY_URL = `http://127.0.0.1:${gateway.address().port}`;
});
after(async () => {
  delete process.env.GATEWAY_URL;
  await new Promise((resolve) => gateway.close(resolve));
});

async function withHangAbortSpy(run) {
  const requestedMsLog = [];
  const originalAbortTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (ms) => {
    requestedMsLog.push(ms);
    const controller = new AbortController();
    pendingAborts.add(() => controller.abort(new DOMException("Zeitablauf (Testattrappe)", "TimeoutError")));
    return controller.signal;
  };
  try {
    return await run(requestedMsLog);
  } finally {
    AbortSignal.timeout = originalAbortTimeout;
    pendingAborts.clear();
  }
}

const HOP_CASES = [
  { tool: "cancel_call", args: { call_id: "c_hopfrist" } },
  { tool: "answer_consult", args: { call_id: "c_hopfrist", event_id: "e_hopfrist", status: "final", answers: ["x"] } },
  { tool: "check_inbox", args: {} },
  { tool: "get_call_status", args: { call_id: "c_hopfrist" } },
];

for (const { tool, args } of HOP_CASES) {
  test(`${tool}: Zeitablauf wird zu HOP_TIMEOUT (isError, MCP_HOP_TIMEOUT_MS protokolliert), in jeder Sprache`, async () => {
    for (const language of ["de", "en", "fr"]) {
      await withHangAbortSpy(async (requestedMsLog) => {
        const handlers = captureToolHandlers({ identity: null, scopedTenant: `tenant_hop_${tool}`, language, consultAllowed: true });
        const result = await handlers.get(tool)(args);
        assert.equal(result.isError, true, `${tool}/${language} muss isError sein`);
        assert.equal(
          result.content[0].text,
          MCP_TEXTS[language].errors[MCP_ERROR_CODE.HOP_TIMEOUT],
          `${tool}/${language}: Text muss der HOP_TIMEOUT-Text der Tenant-Sprache sein`,
        );
        assert.ok(
          requestedMsLog.includes(MCP_HOP_TIMEOUT_MS),
          `${tool}/${language}: AbortSignal.timeout muss mit MCP_HOP_TIMEOUT_MS (${MCP_HOP_TIMEOUT_MS}) aufgerufen worden sein, protokolliert: ${JSON.stringify(requestedMsLog)}`,
        );
      });
    }
  });
}

test("Gegenprobe: await_call_event protokolliert weiter CONSULT_POLL_ABORT_MS (eigene Frist, unveraendert)", async () => {
  await withHangAbortSpy(async (requestedMsLog) => {
    const handlers = captureToolHandlers({ identity: null, scopedTenant: "tenant_hop_gegen1", language: "de", consultAllowed: true });
    const result = await handlers.get("await_call_event")({ call_id: "c_hopfrist" });
    assert.notEqual(result.isError, true, "await_call_event darf bei Zeitablauf NICHT isError sein");
    assert.deepEqual(
      requestedMsLog,
      [CONSULT_POLL_ABORT_MS],
      `await_call_event muss weiterhin CONSULT_POLL_ABORT_MS (${CONSULT_POLL_ABORT_MS}) verwenden, nicht MCP_HOP_TIMEOUT_MS`,
    );
  });
});

test("Gegenprobe: place_call protokolliert weiter PLACE_CALL_HOP_TIMEOUT_MS (eigene Frist, unveraendert)", async () => {
  await withHangAbortSpy(async (requestedMsLog) => {
    const handlers = captureToolHandlers({ identity: null, scopedTenant: "tenant_hop_gegen2", language: "de" });
    const result = await handlers.get("place_call")({ to: "+491511234", objective: "Test" });
    assert.equal(result.isError, true, "place_call muss bei Zeitablauf weiterhin isError sein (CALL_START_UNCONFIRMED)");
    assert.equal(result.content[0].text, MCP_TEXTS.de.errors[MCP_ERROR_CODE.CALL_START_UNCONFIRMED]);
    assert.deepEqual(
      requestedMsLog,
      [MCP_HOP_TIMEOUT_MS, PLACE_CALL_HOP_TIMEOUT_MS],
      `place_call muss fuer den Bestaetigungs-Hop MCP_HOP_TIMEOUT_MS (${MCP_HOP_TIMEOUT_MS}) und fuer den Anrufstart weiterhin PLACE_CALL_HOP_TIMEOUT_MS (${PLACE_CALL_HOP_TIMEOUT_MS}) verwenden`,
    );
  });
});

test("MCP_HOP_TIMEOUT_MS liegt STRUKTURELL ueber dem laengsten begrenzten Serverweg (cancel_call auf gebundenem EL-Inbound)", () => {
  assert.ok(EL_TERMINATION_RESULT_ATTEMPTS > 0, "EL_TERMINATION_RESULT_ATTEMPTS muss positiv sein");
  assert.ok(EL_ABORT_PROVIDER_TIMEOUT_MS > 0, "EL_ABORT_PROVIDER_TIMEOUT_MS muss positiv sein");
  assert.ok(config.voice.elevenLabsOutbound.resultPollMs > 0, "resultPollMs muss positiv sein");

  const laengsterServerweg =
    EL_TERMINATION_RESULT_ATTEMPTS * EL_ABORT_PROVIDER_TIMEOUT_MS +
    (EL_TERMINATION_RESULT_ATTEMPTS - 1) * config.voice.elevenLabsOutbound.resultPollMs;
  assert.ok(
    MCP_HOP_TIMEOUT_MS > laengsterServerweg,
    `MCP_HOP_TIMEOUT_MS (${MCP_HOP_TIMEOUT_MS}) muss > laengster Serverweg (${laengsterServerweg}) sein`,
  );
});

const jsonAntwort = (status, value) => ({ status, body: JSON.stringify(value) });
const rohAntwort = (status, body) => ({ status, body });
const HAENGT = null;

async function withGateway(respond, run) {
  const requests = [];
  const server = http.createServer((req, res) => {
    req.resume();
    requests.push({
      method: req.method,
      path: req.url,
      identity: req.headers["x-internal-identity"],
      tenant: req.headers["x-internal-tenant"],
    });
    const answer = respond(req.method, req.url);
    if (answer === HAENGT) {
      for (const abort of pendingAborts) abort();
      pendingAborts.clear();
      return;
    }
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(answer.body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previousUrl = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(requests);
  } finally {
    process.env.GATEWAY_URL = previousUrl;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const ANRUF_ARGS = { to: "+491511234", objective: "Test" };
const BESTAETIGT = jsonAntwort(HTTP_OK, { preview: ANRUF_ARGS, confirmed: true });
const DE_FEHLER = MCP_TEXTS.de.errors;

function placeCallGateway(callStartAnswer) {
  return (method, path) => (path === "/api/call-confirmations" ? BESTAETIGT : callStartAnswer);
}

const callStarts = (requests) => requests.filter(({ method, path }) => method === "POST" && path === "/api/calls");

const deHandlers = (tenant, extra = {}) =>
  captureToolHandlers({ identity: null, scopedTenant: tenant, language: "de", ...extra });

test("[NIE1] place_call: ausbleibende Antwort auf POST /api/calls ist CALL_START_UNCONFIRMED, der POST geht genau einmal hinaus", async () => {
  await withGateway(placeCallGateway(HAENGT), (requests) =>
    withHangAbortSpy(async () => {
      const result = await deHandlers("tenant_nie1_haengt").get("place_call")(ANRUF_ARGS);
      assert.equal(result.isError, true);
      assert.equal(result.content[0].text, DE_FEHLER[MCP_ERROR_CODE.CALL_START_UNCONFIRMED]);
      assert.equal(callStarts(requests).length, 1, "place_call darf POST /api/calls nur einmal schicken");
    }),
  );
});

const SERVER_FEHLER_OHNE_GRUND = [
  { name: "500 leer", answer: jsonAntwort(500, {}) },
  { name: "502 ohne JSON", answer: rohAntwort(502, "Bad Gateway") },
  { name: "503 leer", answer: jsonAntwort(503, {}) },
  { name: "599 mit error-Feld", answer: jsonAntwort(599, { error: "intern" }) },
];

test("[NIE1] place_call: 5xx ohne Grund auf POST /api/calls ist CALL_START_REJECTED, der POST geht genau einmal hinaus", async () => {
  for (const { name, answer } of SERVER_FEHLER_OHNE_GRUND) {
    await withGateway(placeCallGateway(answer), async (requests) => {
      const result = await deHandlers("tenant_nie1_5xx").get("place_call")(ANRUF_ARGS);
      assert.equal(result.isError, true, `${name}: isError`);
      assert.equal(result.content[0].text, DE_FEHLER[MCP_ERROR_CODE.CALL_START_REJECTED], `${name}: Text`);
      assert.equal(callStarts(requests).length, 1, `${name}: POST /api/calls genau einmal`);
    });
  }
});

test("place_call: nur 5xx ohne Grund wird zu CALL_START_REJECTED, 404 und Status ueber 599 nicht", async () => {
  const faelle = [
    { answer: jsonAntwort(404, {}), expected: DE_FEHLER[MCP_ERROR_CODE.NOT_FOUND] },
    { answer: jsonAntwort(400, {}), expected: DE_FEHLER[MCP_ERROR_CODE.REQUEST_REJECTED] },
    { answer: jsonAntwort(600, {}), expected: DE_FEHLER[MCP_ERROR_CODE.UPSTREAM_UNREACHABLE] },
    { answer: jsonAntwort(500, { reason: "unbekannter_grund" }), expected: DE_FEHLER[MCP_ERROR_CODE.DENIAL_UNKNOWN] },
  ];
  for (const { answer, expected } of faelle) {
    await withGateway(placeCallGateway(answer), async () => {
      const result = await deHandlers("tenant_start_status").get("place_call")(ANRUF_ARGS);
      assert.equal(result.isError, true, `Status ${answer.status}: isError`);
      assert.equal(result.content[0].text, expected, `Status ${answer.status}: Text`);
    });
  }
});

const NIE2_CALL_ID = "c_nie2";
const NIE2_CALL_PATH = `/api/calls/${NIE2_CALL_ID}`;
const NIE2_STATE = {
  agent: { number: "+4930123456", owner: "Antonio" },
  calls: [],
  actionItems: [],
  usage: { calls: 0 },
  settings: { allowSummaries: true, allowPersonalData: false, allowBankData: false },
};
const NIE2_ANTWORTEN = new Map([
  ["POST /api/call-confirmations", BESTAETIGT],
  ["POST /api/calls", jsonAntwort(HTTP_OK, { callId: NIE2_CALL_ID })],
  [`GET ${NIE2_CALL_PATH}/consult`, jsonAntwort(HTTP_OK, { event: CONSULT_EVENT.DONE, eventId: null, questions: [] })],
  [
    `GET ${NIE2_CALL_PATH}`,
    jsonAntwort(HTTP_OK, {
      status: "completed",
      transcript: [],
      startedAt: "2026-10-01T10:00:00.000Z",
      endedAt: "2026-10-01T10:01:00.000Z",
      summary: "Termin steht",
    }),
  ],
  [`POST ${NIE2_CALL_PATH}/consult/answer`, jsonAntwort(HTTP_OK, { merged_facts: 1 })],
  [`POST ${NIE2_CALL_PATH}/cancel`, jsonAntwort(HTTP_OK, { ok: true })],
  ["GET /api/state", jsonAntwort(HTTP_OK, NIE2_STATE)],
  ["POST /api/inbox/poll", jsonAntwort(HTTP_OK, { entries: [], remaining: 0 })],
]);
const nie2Gateway = (method, path) => NIE2_ANTWORTEN.get(`${method} ${path}`) ?? jsonAntwort(404, {});

const NIE2_WERKZEUGE = [
  { tool: "prepare_call", args: ANRUF_ARGS, hops: ["POST /api/call-confirmations"] },
  { tool: "place_call", args: ANRUF_ARGS, hops: ["POST /api/call-confirmations", "POST /api/calls"] },
  { tool: "await_call_event", args: { call_id: NIE2_CALL_ID }, hops: [`GET ${NIE2_CALL_PATH}/consult`, `GET ${NIE2_CALL_PATH}`] },
  {
    tool: "answer_consult",
    args: { call_id: NIE2_CALL_ID, event_id: "e_nie2", status: "final", answers: ["Ja"] },
    hops: [`POST ${NIE2_CALL_PATH}/consult/answer`],
  },
  { tool: "get_call_status", args: { call_id: NIE2_CALL_ID }, hops: [`GET ${NIE2_CALL_PATH}`] },
  { tool: "get_call_result", args: { call_id: NIE2_CALL_ID }, hops: [`GET ${NIE2_CALL_PATH}`] },
  { tool: "cancel_call", args: { call_id: NIE2_CALL_ID }, hops: [`POST ${NIE2_CALL_PATH}/cancel`] },
  { tool: "get_agent_number", args: {}, hops: ["GET /api/state"] },
  { tool: "list_calls", args: {}, hops: ["GET /api/state"] },
  { tool: "check_inbox", args: {}, hops: ["POST /api/inbox/poll"] },
  { tool: "list_action_items", args: {}, hops: ["GET /api/state"] },
  { tool: "get_agent_status", args: {}, hops: ["GET /api/state"] },
];

const NIE2_KOPFZEILEN = [
  { identity: "ident_nie2", scopedTenant: "tenant_nie2" },
  { identity: "ident_nie2", scopedTenant: null },
  { identity: null, scopedTenant: "tenant_nie2" },
];

test("[NIE2] jeder Gateway-Aufruf der zwoelf Werkzeuge traegt X-Internal-Identity und X-Internal-Tenant aus registerTools, auch Rueckfrage-Abwarten und Folgeabruf", async () => {
  for (const { identity, scopedTenant } of NIE2_KOPFZEILEN) {
    const handlers = captureToolHandlers({ identity, scopedTenant, language: "de", consultAllowed: true });
    assert.deepEqual(
      [...handlers.keys()].sort(),
      NIE2_WERKZEUGE.map(({ tool }) => tool).sort(),
      "die Tabelle muss alle registrierten Werkzeuge abdecken",
    );
    await withGateway(nie2Gateway, async (requests) => {
      for (const { tool, args, hops } of NIE2_WERKZEUGE) {
        const ersterAufruf = requests.length;
        const result = await handlers.get(tool)(args);
        assert.notEqual(result.isError, true, `${tool}: darf nicht scheitern (${result.content?.[0]?.text})`);
        assert.deepEqual(
          requests.slice(ersterAufruf),
          hops.map((hop) => {
            const [method, path] = hop.split(" ");
            return { method, path, identity: identity ?? undefined, tenant: scopedTenant ?? undefined };
          }),
          `${tool} (identity=${identity}, scopedTenant=${scopedTenant}): jeder Gateway-Aufruf traegt die Kopfzeilen`,
        );
      }
    });
  }
});

const getCallStatus = (tenant) => deHandlers(tenant).get("get_call_status")({ call_id: "c_fehlerbild" });

test("Gateway-Fehlerbilder werden zu den Texten des Werkzeugs (get_call_status)", async () => {
  const faelle = [
    { name: "404 ohne JSON-Koerper", answer: rohAntwort(404, "nicht gefunden"), expected: DE_FEHLER[MCP_ERROR_CODE.NOT_FOUND] },
    {
      name: "400 mit Hinweis im Feld error",
      answer: jsonAntwort(400, { error: "call_id hat kein gueltiges Format" }),
      expected: "call_id hat kein gueltiges Format",
    },
    {
      name: "400 mit nicht-textlichem error",
      answer: jsonAntwort(400, { error: { code: 1 } }),
      expected: DE_FEHLER[MCP_ERROR_CODE.REQUEST_REJECTED],
    },
    { name: "200 mit Text statt Objekt", answer: jsonAntwort(HTTP_OK, "kein Objekt"), expected: DE_FEHLER[MCP_ERROR_CODE.UPSTREAM_INVALID] },
    { name: "200 ohne JSON-Koerper", answer: rohAntwort(HTTP_OK, "kein JSON"), expected: DE_FEHLER[MCP_ERROR_CODE.UPSTREAM_INCOMPLETE] },
  ];
  for (const { name, answer, expected } of faelle) {
    await withGateway(() => answer, async () => {
      const result = await getCallStatus("tenant_fehlerbild");
      assert.equal(result.isError, true, `${name}: isError`);
      assert.equal(result.content[0].text, expected, `${name}: Text`);
    });
  }
});

test("5xx des Gateways ohne Grund: das Modell sieht nur UPSTREAM_UNREACHABLE, das Betreiberprotokoll nennt upstream_status", async (t) => {
  const errorLog = t.mock.method(console, "error", () => {});
  await withGateway(() => jsonAntwort(500, {}), async () => {
    const result = await getCallStatus("tenant_5xx_log");
    assert.equal(result.content[0].text, DE_FEHLER[MCP_ERROR_CODE.UPSTREAM_UNREACHABLE]);
  });
  assert.ok(
    errorLog.mock.calls.some(({ arguments: logArgs }) => logArgs.includes("upstream_status")),
    "das Protokoll muss den Fehler upstream_status nennen",
  );
});

test("Pflichtfelder der Gateway-Antwort: falscher Typ oder null ist UPSTREAM_INCOMPLETE", async () => {
  const faelle = [
    { tool: "prepare_call", args: ANRUF_ARGS, path: "/api/call-confirmations", body: { preview: null } },
    { tool: "prepare_call", args: ANRUF_ARGS, path: "/api/call-confirmations", body: { preview: "Vorschau" } },
    { tool: "check_inbox", args: {}, path: "/api/inbox/poll", body: { entries: [], remaining: "3" } },
  ];
  for (const { tool, args, path, body } of faelle) {
    await withGateway((_method, requestPath) => (requestPath === path ? jsonAntwort(HTTP_OK, body) : jsonAntwort(404, {})), async () => {
      const result = await deHandlers("tenant_pflichtfelder").get(tool)(args);
      assert.equal(result.isError, true, `${tool} ${JSON.stringify(body)}: isError`);
      assert.equal(result.content[0].text, DE_FEHLER[MCP_ERROR_CODE.UPSTREAM_INCOMPLETE], `${tool} ${JSON.stringify(body)}: Text`);
    });
  }
});

test("prepare_call: Fehler der Bestaetigung werden zu den passenden Texten, ohne Anrufstart", async () => {
  const faelle = [
    {
      answer: jsonAntwort(503, { reason: "confirmation_unavailable" }),
      expected: DE_FEHLER[MCP_ERROR_CODE.CONFIRMATION_UNAVAILABLE],
    },
    { answer: jsonAntwort(503, { reason: "anderer_grund" }), expected: DE_FEHLER[MCP_ERROR_CODE.DENIAL_UNKNOWN] },
    { answer: jsonAntwort(500, { reason: "confirmation_unavailable" }), expected: DE_FEHLER[MCP_ERROR_CODE.DENIAL_UNKNOWN] },
    { answer: jsonAntwort(404, {}), expected: DE_FEHLER[MCP_ERROR_CODE.NOT_FOUND] },
  ];
  for (const { answer, expected } of faelle) {
    await withGateway(() => answer, async (requests) => {
      const result = await deHandlers("tenant_bestaetigung").get("prepare_call")(ANRUF_ARGS);
      const fall = `${answer.status} ${answer.body}`;
      assert.equal(result.isError, true, `${fall}: isError`);
      assert.equal(result.content[0].text, expected, `${fall}: Text`);
      assert.equal(callStarts(requests).length, 0, `${fall}: kein Anrufstart`);
    });
  }
});

test("prepare_call: ausbleibende Bestaetigung ist HOP_TIMEOUT", async () => {
  await withGateway(() => HAENGT, (requests) =>
    withHangAbortSpy(async () => {
      const result = await deHandlers("tenant_bestaetigung_haengt").get("prepare_call")(ANRUF_ARGS);
      assert.equal(result.isError, true);
      assert.equal(result.content[0].text, DE_FEHLER[MCP_ERROR_CODE.HOP_TIMEOUT]);
      assert.equal(callStarts(requests).length, 0);
    }),
  );
});

test("get_call_status: ein abgebrochener Hop (AbortError) ist HOP_TIMEOUT", async () => {
  const originalAbortTimeout = AbortSignal.timeout;
  AbortSignal.timeout = () => AbortSignal.abort();
  try {
    const result = await getCallStatus("tenant_abort_error");
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, DE_FEHLER[MCP_ERROR_CODE.HOP_TIMEOUT]);
  } finally {
    AbortSignal.timeout = originalAbortTimeout;
  }
});

test("await_call_event: Zeitablauf beim Abwarten meldet kein Ereignis und keine Fragen", async () => {
  await withHangAbortSpy(async () => {
    const handlers = deHandlers("tenant_kein_ereignis", { consultAllowed: true });
    const result = await handlers.get("await_call_event")({ call_id: "c_kein_ereignis" });
    assert.equal(result.structuredContent.event, CONSULT_EVENT.NONE);
    assert.equal(result.structuredContent.event_id, null);
    assert.deepEqual(result.structuredContent.questions, []);
  });
});
