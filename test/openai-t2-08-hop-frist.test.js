import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { MCP_HOP_TIMEOUT_MS, PLACE_CALL_HOP_TIMEOUT_MS } from "../src/mcp-tools.js";
import { MCP_TEXTS, MCP_ERROR_CODE } from "../src/i18n/mcp-texts.js";
import { CONSULT_POLL_ABORT_MS } from "../src/consult/delivery.js";
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
