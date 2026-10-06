import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const CALL_TEXT = "call_al_p1_text";
const CALL_SILENT = "call_al_p1_silent";

function message(content) {
  return {
    id: "msg_al_p1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}
const textOnly = (text) => message([{ type: "text", text }]);

let nextResponse;
let agentTurn, store;
let server;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(nextResponse));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-al-p1-key";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls: [
        seedCall({
          id: CALL_TEXT,
          tenantId: BOOTSTRAP_TENANT_ID,
          direction: "outbound",
          goal: "Testziel",
          transcript: [{ role: "agent", text: "Guten Tag." }],
        }),
        seedCall({
          id: CALL_SILENT,
          tenantId: BOOTSTRAP_TENANT_ID,
          direction: "outbound",
          goal: "Testziel",
          transcript: [{ role: "agent", text: "Guten Tag." }],
        }),
      ],
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  ({ agentTurn } = await import("../src/claude.js"));
});
after(async () => {
  await new Promise((r) => server.close(r));
});

test("AL-P1-6: agentTurn zaehlt callerTurns nur bei nicht-leerem callerText und liefert roundtrips/toolNames", async () => {
  nextResponse = textOnly("Alles klar.");
  const turnsBefore = store.getCall(CALL_TEXT).callerTurns;
  const turn = await agentTurn(store.getCall(CALL_TEXT), "Guten Tag, worum geht es?");
  assert.equal(store.getCall(CALL_TEXT).callerTurns, turnsBefore + 1, "nicht-leerer callerText zaehlt einen Turn");
  assert.equal(turn.roundtrips, 1, "genau ein llm.complete-Roundtrip (keine Tools angefordert)");
  assert.deepEqual(turn.toolNames, [], "keine Tools angefordert -> leeres Array");

  const silentBefore = store.getCall(CALL_SILENT).callerTurns;
  nextResponse = textOnly("Ich bin noch da.");
  await agentTurn(store.getCall(CALL_SILENT), null);
  assert.equal(
    store.getCall(CALL_SILENT).callerTurns,
    silentBefore,
    "callerText=null (Stiller Turn) zaehlt NICHT mit",
  );
});
