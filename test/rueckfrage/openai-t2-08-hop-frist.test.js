import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { MCP_HOP_TIMEOUT_MS, PLACE_CALL_HOP_TIMEOUT_MS } from "../../src/mcp-tools.js";
import { MCP_TEXTS, MCP_ERROR_CODE } from "../../src/i18n/mcp-texts.js";
import { CONSULT_POLL_ABORT_MS } from "../../src/consult/delivery.js";
import { CONSULT_EVENT } from "../../src/consult/delivery.js";
import { config } from "../../src/config.js";
import { captureToolHandlers } from "../gemeinsam/werkzeug-registrierung.js";
import {
  EL_TERMINATION_RESULT_ATTEMPTS,
  EL_ABORT_PROVIDER_TIMEOUT_MS,
} from "../../src/elevenlabs/outbound.js";

const HTTP_OK = 200;
const pendingAborts = new Set();
let gateway;
before(async () => {
  gateway = http.createServer((req) => {
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
      [PLACE_CALL_HOP_TIMEOUT_MS],
      `place_call muss fuer den Anrufstart weiterhin PLACE_CALL_HOP_TIMEOUT_MS (${PLACE_CALL_HOP_TIMEOUT_MS}) verwenden`,
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

const HTTP_NOT_FOUND = 404;
const HTTP_UNAVAILABLE = 503;
const HTTP_LAST_SERVER_ERROR = 599;
const HTTP_BEYOND_SERVER_ERRORS = 600;
const PLACE_CALL_ARGS = { to: "+491511234", objective: "Test" };
const HANG = null;

function sendReply(res, reply) {
  const isRaw = typeof reply.raw === "string";
  res.writeHead(reply.status, { "content-type": isRaw ? "text/plain" : "application/json" });
  res.end(isRaw ? reply.raw : JSON.stringify(reply.json));
}

async function withScriptedGateway(respond, run) {
  const requests = [];
  const server = http.createServer((req, res) => {
    req.resume();
    requests.push({
      method: req.method,
      url: req.url,
      identity: req.headers["x-internal-identity"],
      tenant: req.headers["x-internal-tenant"],
    });
    const reply = respond(req);
    if (reply) return sendReply(res, reply);
    for (const abort of pendingAborts) abort();
    pendingAborts.clear();
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

const callStartAnswers = (reply) => () => reply;

async function runTool(tool, args) {
  const handlers = captureToolHandlers({ identity: null, scopedTenant: "tenant_hop_absicherung", language: "de", consultAllowed: true });
  return handlers.get(tool)(args);
}

async function assertToolErrorText({ respond, tool, args }, expectedText) {
  await withScriptedGateway(respond, async () => {
    const result = await runTool(tool, args);
    assert.equal(result.isError, true, `${tool} muss isError sein`);
    assert.equal(result.content[0].text, expectedText);
  });
}

const errorText = (code) => MCP_TEXTS.de.errors[code];

test("place_call: 4xx ohne Grund beim Anrufstart meldet den Statustext, nicht CALL_START_REJECTED", async () => {
  await assertToolErrorText(
    { respond: callStartAnswers({ status: HTTP_NOT_FOUND, json: {} }), tool: "place_call", args: PLACE_CALL_ARGS },
    errorText(MCP_ERROR_CODE.NOT_FOUND),
  );
});

test("place_call: 599 ohne Grund ist CALL_START_REJECTED", async () => {
  await assertToolErrorText(
    { respond: callStartAnswers({ status: HTTP_LAST_SERVER_ERROR, json: {} }), tool: "place_call", args: PLACE_CALL_ARGS },
    errorText(MCP_ERROR_CODE.CALL_START_REJECTED),
  );
});

test("place_call: ein Status ueber 599 ist kein CALL_START_REJECTED", async () => {
  await assertToolErrorText(
    { respond: callStartAnswers({ status: HTTP_BEYOND_SERVER_ERRORS, json: {} }), tool: "place_call", args: PLACE_CALL_ARGS },
    errorText(MCP_ERROR_CODE.UPSTREAM_UNREACHABLE),
  );
});

test("cancel_call: Fehlerantwort ohne JSON-Koerper meldet den Statustext", async () => {
  await assertToolErrorText(
    { respond: () => ({ status: HTTP_NOT_FOUND, raw: "nicht gefunden" }), tool: "cancel_call", args: { call_id: "c_ohne_json" } },
    errorText(MCP_ERROR_CODE.NOT_FOUND),
  );
});

test("get_agent_number: agent null ist UPSTREAM_INCOMPLETE", async () => {
  await assertToolErrorText(
    { respond: () => ({ status: HTTP_OK, json: { agent: null } }), tool: "get_agent_number", args: {} },
    errorText(MCP_ERROR_CODE.UPSTREAM_INCOMPLETE),
  );
});

test("get_agent_number: agent als Text statt Objekt ist UPSTREAM_INCOMPLETE", async () => {
  await assertToolErrorText(
    { respond: () => ({ status: HTTP_OK, json: { agent: "+4930123" } }), tool: "get_agent_number", args: {} },
    errorText(MCP_ERROR_CODE.UPSTREAM_INCOMPLETE),
  );
});

test("get_agent_number: eine Antwort, die kein Objekt ist, ist UPSTREAM_INVALID", async () => {
  await assertToolErrorText(
    { respond: () => ({ status: HTTP_OK, json: "kein Objekt" }), tool: "get_agent_number", args: {} },
    errorText(MCP_ERROR_CODE.UPSTREAM_INVALID),
  );
});

test("cancel_call: Abbruch mit AbortError wird ebenfalls zu HOP_TIMEOUT", async () => {
  const originalAbortTimeout = AbortSignal.timeout;
  AbortSignal.timeout = () => {
    const controller = new AbortController();
    pendingAborts.add(() => controller.abort());
    return controller.signal;
  };
  try {
    const result = await runTool("cancel_call", { call_id: "c_abort" });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, errorText(MCP_ERROR_CODE.HOP_TIMEOUT));
  } finally {
    AbortSignal.timeout = originalAbortTimeout;
    pendingAborts.clear();
  }
});

test("await_call_event: Zeitablauf liefert das Ereignis none ohne Fragen", async () => {
  await withHangAbortSpy(async () => {
    const result = await runTool("await_call_event", { call_id: "c_hopfrist" });
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.event, CONSULT_EVENT.NONE);
    assert.equal(result.structuredContent.event_id, null);
    assert.deepEqual(result.structuredContent.questions, []);
  });
});

const callStarts = (requests) =>
  requests.filter((request) => request.method === "POST" && request.url === "/api/calls");

test("[NIE1] place_call: ausbleibende Antwort auf POST /api/calls ist CALL_START_UNCONFIRMED, POST genau einmal", async () => {
  await withHangAbortSpy(async () => {
    await withScriptedGateway(callStartAnswers(HANG), async (requests) => {
      const result = await runTool("place_call", PLACE_CALL_ARGS);
      assert.equal(result.isError, true);
      assert.equal(result.content[0].text, errorText(MCP_ERROR_CODE.CALL_START_UNCONFIRMED));
      assert.equal(callStarts(requests).length, 1);
    });
  });
});

test("[NIE1] place_call: 5xx ohne Grund ist CALL_START_REJECTED, POST genau einmal", async () => {
  await withScriptedGateway(callStartAnswers({ status: HTTP_UNAVAILABLE, json: {} }), async (requests) => {
    const result = await runTool("place_call", PLACE_CALL_ARGS);
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, errorText(MCP_ERROR_CODE.CALL_START_REJECTED));
    assert.equal(callStarts(requests).length, 1);
  });
});

const KOPF_CALL_ID = "c_kopfzeilen";
const KOPF_CALL = {
  id: KOPF_CALL_ID,
  status: "completed",
  startedAt: "2026-11-01T10:00:00.000Z",
  endedAt: "2026-11-01T10:01:00.000Z",
  transcript: [],
};
const KOPF_STATE = {
  agent: { number: "+4930123" },
  calls: [],
  actionItems: [],
  usage: {},
  settings: {},
};
const KOPF_ROUTES = new Map([
  ["POST /api/calls", { callId: KOPF_CALL_ID }],
  [`GET /api/calls/${KOPF_CALL_ID}/consult`, { event: CONSULT_EVENT.DONE, eventId: "e_kopf", questions: [] }],
  [`GET /api/calls/${KOPF_CALL_ID}`, KOPF_CALL],
  [`POST /api/calls/${KOPF_CALL_ID}/consult/answer`, { merged_facts: 0 }],
  [`POST /api/calls/${KOPF_CALL_ID}/cancel`, { ok: true }],
  ["GET /api/state", KOPF_STATE],
  ["POST /api/inbox/poll", { entries: [], remaining: 0 }],
]);
const KOPF_TOOL_CALLS = [
  ["place_call", PLACE_CALL_ARGS, ["POST /api/calls"]],
  ["await_call_event", { call_id: KOPF_CALL_ID }, [`GET /api/calls/${KOPF_CALL_ID}/consult`, `GET /api/calls/${KOPF_CALL_ID}`]],
  ["answer_consult", { call_id: KOPF_CALL_ID, event_id: "e_kopf", status: "working" }, [`POST /api/calls/${KOPF_CALL_ID}/consult/answer`]],
  ["get_call_status", { call_id: KOPF_CALL_ID }, [`GET /api/calls/${KOPF_CALL_ID}`]],
  ["get_call_result", { call_id: KOPF_CALL_ID }, [`GET /api/calls/${KOPF_CALL_ID}`]],
  ["cancel_call", { call_id: KOPF_CALL_ID }, [`POST /api/calls/${KOPF_CALL_ID}/cancel`]],
  ["get_agent_number", {}, ["GET /api/state"]],
  ["list_calls", {}, ["GET /api/state"]],
  ["check_inbox", {}, ["POST /api/inbox/poll"]],
  ["list_action_items", {}, ["GET /api/state"]],
  ["get_agent_status", {}, ["GET /api/state"]],
];

test("[NIE2] jeder Gateway-Aufruf der elf Werkzeuge traegt X-Internal-Identity und X-Internal-Tenant", async () => {
  const kopf = { identity: "kunde@example.test", tenant: "tenant_kopfzeilen" };
  const respond = (req) => ({ status: HTTP_OK, json: KOPF_ROUTES.get(`${req.method} ${req.url.split("?")[0]}`) ?? {} });
  await withScriptedGateway(respond, async (requests) => {
    const handlers = captureToolHandlers({ identity: kopf.identity, scopedTenant: kopf.tenant, language: "de", consultAllowed: true });
    assert.equal(handlers.size, KOPF_TOOL_CALLS.length);
    for (const [tool, args, expectedHops] of KOPF_TOOL_CALLS) {
      const firstHop = requests.length;
      await handlers.get(tool)(args);
      const toolHops = requests.slice(firstHop);
      assert.deepEqual(
        toolHops.map((request) => `${request.method} ${request.url}`),
        expectedHops,
        `${tool}: erwartete Gateway-Aufrufe`,
      );
      for (const request of toolHops) {
        assert.deepEqual(
          { identity: request.identity, tenant: request.tenant },
          kopf,
          `${tool}: ${request.method} ${request.url} ohne die Kopfzeilen des Aufrufers`,
        );
      }
    }
  });
});

const HTTP_SERVER_ERROR = 500;
const UNKNOWN_ERROR_LOG_PREFIX = "[mcp] Tool-Fehler ohne bekannte Kennung:";

test("cancel_call: 500 ohne Grund steht als Gateway-Status im Server-Log, das Modell bekommt den neutralen Text", async (t) => {
  const error = t.mock.method(console, "error", () => {});
  await assertToolErrorText(
    { respond: () => ({ status: HTTP_SERVER_ERROR, json: {} }), tool: "cancel_call", args: { call_id: "c_serverfehler" } },
    errorText(MCP_ERROR_CODE.UPSTREAM_UNREACHABLE),
  );
  assert.deepEqual(
    error.mock.calls.map((call) => call.arguments),
    [[UNKNOWN_ERROR_LOG_PREFIX, "Error", "upstream_status"]],
  );
});

test("await_call_event: 404 beim Abwarten der Rueckfrage meldet NOT_FOUND und fragt den Anruf nicht ab", async () => {
  await withScriptedGateway(() => ({ status: HTTP_NOT_FOUND, json: {} }), async (requests) => {
    const result = await runTool("await_call_event", { call_id: "c_fremd" });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, errorText(MCP_ERROR_CODE.NOT_FOUND));
    assert.deepEqual(
      requests.map((request) => `${request.method} ${request.url}`),
      ["GET /api/calls/c_fremd/consult"],
    );
  });
});
