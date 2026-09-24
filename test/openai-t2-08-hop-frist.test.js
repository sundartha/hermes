// T2-08 (T-27): Hop-Frist-Test fuer JEDEN uebrigen MCP->REST-Hop (alles ausser
// pollConsult/placeCallHop, die eigene Fristen behalten). Reiner Prozess, kein
// Server-Spawn (Muster test/openai-s3-hop-frist.test.js): eine lokale Gateway-Attrappe
// (http.createServer, antwortet NIE) + GATEWAY_URL darauf, registerTools mit einem
// Fake-Server (captureTools).
//
// Draht-Beleg (a, ausserhalb dieses Tests, per grep): stdio (src/mcp-server.js) UND
// HTTP /mcp (src/routes/mcp.js) teilen registerTools() - ein Test am Handler deckt
// deshalb beide Transporte ab.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools, MCP_HOP_TIMEOUT_MS, PLACE_CALL_HOP_TIMEOUT_MS } from "../src/mcp-tools.js";
import { MCP_TEXTS, MCP_ERROR_CODE } from "../src/i18n/mcp-texts.js";
import { CONSULT_POLL_ABORT_MS } from "../src/consult/delivery.js";
import { config } from "../src/config.js";
import {
  EL_TERMINATION_RESULT_ATTEMPTS,
  EL_ABORT_PROVIDER_TIMEOUT_MS,
} from "../src/elevenlabs/outbound.js";

// Die lokale Gateway-Attrappe antwortet NIE (kein res.end()) - jeder Hop darueber laeuft
// zwingend in seine Frist. req.resume() verhindert einen Backpressure-Hänger auf dem
// Request-Body, ohne selbst zu antworten.
// T2-13 (N-10) Ausnahme: POST /api/call-confirmations antwortet SOFORT mit confirmed:true -
// sonst wuerde schon der neue, vorgeschaltete Bestaetigungs-Hop (MCP_HOP_TIMEOUT_MS) in die
// Frist laufen, BEVOR die eigentlich gepruefte place_call-Frist (PLACE_CALL_HOP_TIMEOUT_MS
// am /api/calls-Hop) je erreicht wird.
const HTTP_OK = 200;
let gateway;
before(async () => {
  gateway = http.createServer((req, res) => {
    if (req.url === "/api/call-confirmations") {
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      return res.end(JSON.stringify({ preview: {}, confirmed: true }));
    }
    return req.resume();
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  process.env.GATEWAY_URL = `http://127.0.0.1:${gateway.address().port}`;
});
after(async () => {
  delete process.env.GATEWAY_URL;
  await new Promise((resolve) => gateway.close(resolve));
});

// Damit der Test nicht wirklich 60s (MCP_HOP_TIMEOUT_MS) bzw. 180s (PLACE_CALL_HOP_TIMEOUT_MS)
// wartet: AbortSignal.timeout wird durch eine Variante ersetzt, die das angeforderte ms
// PROTOKOLLIERT und nach FAST_ABORT_MS abbricht - unabhaengig vom angeforderten Wert. Muss
// in JEDEM Test zurueckgesetzt werden (sonst leckt die Attrappe in andere Testdateien).
const FAST_ABORT_MS = 50;
let requestedMsLog;
let originalAbortTimeout;

function installFastAbortSpy() {
  requestedMsLog = [];
  originalAbortTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (ms) => {
    requestedMsLog.push(ms);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Zeitablauf (Testattrappe)", "TimeoutError")), FAST_ABORT_MS);
    return controller.signal;
  };
}
function restoreAbortSpy() {
  AbortSignal.timeout = originalAbortTimeout;
}

function captureTools(ctx) {
  const handlers = new Map();
  const fakeServer = {
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return handlers;
}

// ==================== cancel_call / answer_consult / check_inbox / get_call_status ====================
const HOP_CASES = [
  { tool: "cancel_call", args: { call_id: "c_hopfrist" } },
  { tool: "answer_consult", args: { call_id: "c_hopfrist", event_id: "e_hopfrist", status: "final", answers: ["x"] } },
  { tool: "check_inbox", args: {} },
  { tool: "get_call_status", args: { call_id: "c_hopfrist" } },
];

for (const { tool, args } of HOP_CASES) {
  test(`${tool}: Zeitablauf wird zu HOP_TIMEOUT (isError, MCP_HOP_TIMEOUT_MS protokolliert), in jeder Sprache`, async () => {
    installFastAbortSpy();
    try {
      for (const language of ["de", "en", "fr"]) {
        requestedMsLog.length = 0;
        const handlers = captureTools({ identity: null, scopedTenant: `tenant_hop_${tool}`, language, consultAllowed: true });
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
      }
    } finally {
      restoreAbortSpy();
    }
  });
}

// ==================== Gegenprobe: await_call_event und place_call bleiben unveraendert ====================
test("Gegenprobe: await_call_event protokolliert weiter CONSULT_POLL_ABORT_MS (eigene Frist, unveraendert)", async () => {
  installFastAbortSpy();
  try {
    const handlers = captureTools({ identity: null, scopedTenant: "tenant_hop_gegen1", language: "de", consultAllowed: true });
    const result = await handlers.get("await_call_event")({ call_id: "c_hopfrist" });
    // Ein Zeitablauf ist bei await_call_event das NORMALE Ergebnis (Long-Poll) - KEIN
    // isError, sondern event:"none" (pollConsult schluckt den Abbruch).
    assert.notEqual(result.isError, true, "await_call_event darf bei Zeitablauf NICHT isError sein");
    assert.deepEqual(
      requestedMsLog,
      [CONSULT_POLL_ABORT_MS],
      `await_call_event muss weiterhin CONSULT_POLL_ABORT_MS (${CONSULT_POLL_ABORT_MS}) verwenden, nicht MCP_HOP_TIMEOUT_MS`,
    );
  } finally {
    restoreAbortSpy();
  }
});

test("Gegenprobe: place_call protokolliert weiter PLACE_CALL_HOP_TIMEOUT_MS (eigene Frist, unveraendert)", async () => {
  installFastAbortSpy();
  try {
    const handlers = captureTools({ identity: null, scopedTenant: "tenant_hop_gegen2", language: "de" });
    const result = await handlers.get("place_call")({ to: "+491511234", objective: "Test" });
    assert.equal(result.isError, true, "place_call muss bei Zeitablauf weiterhin isError sein (CALL_START_UNCONFIRMED)");
    assert.equal(result.content[0].text, MCP_TEXTS.de.errors[MCP_ERROR_CODE.CALL_START_UNCONFIRMED]);
    // T2-13 (N-10): der vorgeschaltete Bestaetigungs-Hop laeuft mit MCP_HOP_TIMEOUT_MS
    // (beantwortet, kein Abbruch) UND vor dem eigentlich gepruefte /api/calls-Hop, der
    // weiterhin PLACE_CALL_HOP_TIMEOUT_MS verwendet und hier tatsaechlich abbricht.
    assert.deepEqual(
      requestedMsLog,
      [MCP_HOP_TIMEOUT_MS, PLACE_CALL_HOP_TIMEOUT_MS],
      `place_call muss fuer den Bestaetigungs-Hop MCP_HOP_TIMEOUT_MS (${MCP_HOP_TIMEOUT_MS}) und fuer den Anrufstart weiterhin PLACE_CALL_HOP_TIMEOUT_MS (${PLACE_CALL_HOP_TIMEOUT_MS}) verwenden`,
    );
  } finally {
    restoreAbortSpy();
  }
});

// ==================== Ungleichungs-Test: MCP_HOP_TIMEOUT_MS strukturell > laengster Serverweg ====================
test("MCP_HOP_TIMEOUT_MS liegt STRUKTURELL ueber dem laengsten begrenzten Serverweg (cancel_call auf gebundenem EL-Inbound)", () => {
  // Positiv-Kontrolle: ohne sie priefte die Ungleichung unten nichts (alle Summanden > 0).
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
