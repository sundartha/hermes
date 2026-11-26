import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall, makeConfigOverrides } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { LOOKUP_MAX_FACTS } from "../../src/research/lookup-guard.ts";
import { makeJsonMessage, makeWriteSse, MOCK_USAGE } from "../anthropic-sse-fixtures.js";

const OWNER = "Jonas Beispiel";
const EXA_KEY = "test-alp10c-exa-key";

function message(content, stopReason) {
  return {
    id: "msg_alp10b",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: MOCK_USAGE,
  };
}

const writeSse = makeWriteSse(makeJsonMessage("msg_alp10b"));

const textOnly = (text) => message([{ type: "text", text }], "end_turn");
const UNWANTED_EXTRA_ROUNDTRIP_MARKER = "UNGEWOLLTER-ZUSATZ-ROUNDTRIP";

let anthropic;
let exa;
let queue = [];
let bodies = [];
let exaRequests = [];
let exaResults = [];
let exaHangs = false;
const hungResponses = [];

let store, config, inCall, withConfig;

const EXA_HIGHLIGHT = "Beleg";
const exaBody = (...titles) => ({
  requestId: "req_alp10c",
  results: titles.map((t, i) => ({
    id: `res_${i}`,
    title: t,
    url: "https://nie.example",
    highlights: [EXA_HIGHLIGHT],
    highlightScores: [0.9],
  })),
  costDollars: { total: 0.01 },
});
before(async () => {
  anthropic = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw);
      bodies.push(body);
      const scripted = queue.shift() || textOnly(UNWANTED_EXTRA_ROUNDTRIP_MARKER);
      if (body.stream === true) return writeSse(res, scripted.content);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(scripted));
    });
  });
  await new Promise((r) => anthropic.listen(0, "127.0.0.1", r));

  exa = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      exaRequests.push({
        method: req.method,
        path: req.url,
        key: req.headers["x-api-key"],
        body: JSON.parse(raw || "{}"),
        at: Date.now(),
      });
      if (exaHangs) {
        hungResponses.push(res);
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(exaResults.shift() || exaBody()));
    });
  });
  await new Promise((r) => exa.listen(0, "127.0.0.1", r));

  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${anthropic.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-alp10b-key";
  process.env.EXA_API_BASE = `http://127.0.0.1:${exa.address().port}`;
  process.env.EXA_API_KEY = EXA_KEY;
  process.env.LOOKUP_ENABLED = "true";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  process.env.THINKING_SIGNAL_ENABLED = "true";
  const calls = [];
  for (let i = 1; i <= 22; i++) calls.push(seedCall({ id: `call_alp10b_${i}` }));
  calls.push(seedCall({ id: "call_alp10b_inbound", direction: "inbound" }));
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls,
    }),
  );
  ({ config } = await import("../../src/config.ts"));
  store = await import("../../src/store.js");
  inCall = await import("../../src/research/in-call.js");
  ({ withConfig } = makeConfigOverrides(config));
});

after(async () => {
  for (const res of hungResponses) res.destroy();
  anthropic?.closeAllConnections?.();
  exa?.closeAllConnections?.();
  if (anthropic) await new Promise((r) => anthropic.close(r));
  if (exa) await new Promise((r) => exa.close(r));
});

test("AL-P10b-5: jeder einzelne Faktor ist fail-closed (Secret, Tenant-Recht, Kontext-Kanal)", async () => {
  const call = store.getCall("call_alp10b_5");
  await withConfig("exaApiKey", "", async () => {
    assert.equal(inCall.lookupAvailableFor(call), false, "ohne Secret aktiv");
  });
  await withConfig("assistantContextEnabled", false, async () => {
    assert.equal(inCall.lookupAvailableFor(call), false, "ohne HINTERGRUND-Kanal aktiv");
  });
  const originalTenant = call.tenantId;
  call.tenantId = "tenant_ohne_recht";
  try {
    assert.equal(inCall.lookupAvailableFor(call), false, "ohne Tenant-Recht aktiv");
  } finally {
    call.tenantId = originalTenant;
  }
  const ended = { ...call, status: "completed" };
  assert.equal(inCall.lookupAvailableFor(ended), false, "beendeter Call aktiv");
});

const EXA_REQUEST_PRICE_CENTS = 0.7;
const EXA_PAGE_PRICE_CENTS = 0.1;

test("AL-P10c-3: die Suchgebuehr deckt die Exa-Preisliste fuer die tatsaechlich geholte Trefferzahl", () => {
  const needed = EXA_REQUEST_PRICE_CENTS + LOOKUP_MAX_FACTS * EXA_PAGE_PRICE_CENTS;
  assert.ok(
    config.research.lookupSearchFeeCents >= needed,
    `LOOKUP_SEARCH_FEE_CENTS=${config.research.lookupSearchFeeCents} deckt die Exa-Preisliste ` +
      `fuer LOOKUP_MAX_FACTS=${LOOKUP_MAX_FACTS} nicht (noetig: ${needed} Cent)`,
  );
});
