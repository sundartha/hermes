import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, MICRO_CENTS_PER_CENT } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const CALL_ID = "call_p8_breaker";
const PEER_NUMBER = "+4915112345678";

const SUMMARY_DECISION = { summary: "Alles erledigt.", actionItems: [], objective_achieved: true };

let mode = "fail";
let requestCount = 0;

function anthropicTextMessage(json) {
  return {
    id: "msg_p8_breaker_text",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text: JSON.stringify(json) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 30 },
  };
}

let server;
let store, summarizeCall, fetchPrecallBriefing;

before(async () => {
  server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      requestCount += 1;
      if (mode === "fail") {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }));
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(anthropicTextMessage(SUMMARY_DECISION)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-p8-breaker-key";
  process.env.PRECALL_BRIEFING_ENABLED = "true";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  process.env.LLM_BREAKER_THRESHOLD = "1";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls: [
        seedCall({
          id: CALL_ID,
          tenantId: BOOTSTRAP_TENANT_ID,
          direction: "outbound",
          goal: "Termin verschieben",
          transcript: [
            { role: "agent", text: "Passt Freitag?" },
            { role: "caller", text: "Ja, passt." },
          ],
        }),
      ],
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  ({ summarizeCall } = await import("../src/claude.js"));
  ({ fetchPrecallBriefing } = await import("../src/precall-briefing.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

const briefingArgs = () => ({
  objective: "Termin verschieben",
  ownerNotes: null,
  constraints: null,
  to: PEER_NUMBER,
  tenantId: BOOTSTRAP_TENANT_ID,
});

test("BR1 ein fehlschlagender Briefing-Aufruf oeffnet den Briefing-Breaker: zweiter Aufruf -> sofort null, KEIN zweiter Request", async () => {
  mode = "fail";
  const before = requestCount;

  const first = await fetchPrecallBriefing(briefingArgs());
  assert.equal(first, null, "erster Aufruf scheitert am HTTP-500");
  const afterFirst = requestCount;
  assert.equal(afterFirst, before + 1, "erster Aufruf loest genau EINEN Request aus");
  const usageAfterFirst = { ...store.usageOf(BOOTSTRAP_TENANT_ID) };
  assert.ok(
    usageAfterFirst.costCents * MICRO_CENTS_PER_CENT + usageAfterFirst.costMicroCentsRem > 0,
    "der gesendete 500er bucht eine Schaetzung",
  );

  const second = await fetchPrecallBriefing(briefingArgs());
  assert.equal(second, null, "zweiter Aufruf ist sofort null (Breaker offen)");
  assert.equal(requestCount, afterFirst, "Breaker offen -> KEIN zweiter HTTP-Request");
  assert.deepEqual(
    store.usageOf(BOOTSTRAP_TENANT_ID),
    usageAfterFirst,
    "Breaker-open darf keine weitere Buchung ausloesen",
  );
});

test("BR2 der Gespraechs-Breaker (claude.js) bleibt UNBERUEHRT: summarizeCall liefert weiterhin ein Ergebnis", async () => {
  mode = "summary";
  const call = store.getCall(CALL_ID);
  const result = await summarizeCall(call);
  assert.ok(result, "summarizeCall darf NICHT durch den fremden (Briefing-)Breaker blockiert werden");
  assert.equal(call.summary, SUMMARY_DECISION.summary);
});
