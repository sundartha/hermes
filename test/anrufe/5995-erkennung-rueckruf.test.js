import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";

const CALL_ID = "call_5995_erk";
const TRANSCRIPT = [
  { role: "agent", text: "Wie koennen wir Ihnen helfen?" },
  { role: "caller", text: "Rufen Sie mich morgen um 10 Uhr zurueck." },
];

let server;
let lastRequest = null;
let store, summarizeCall;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      lastRequest = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_5995_erk",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [{ type: "text", text: JSON.stringify({ summary: "Rueckruf gewuenscht.", actionItems: [], objective_achieved: "unclear" }) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 20, output_tokens: 30 },
        }),
      );
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-5995-erk-key";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }],
      calls: [seedCall({ id: CALL_ID, direction: "inbound", goal: "Anliegen klaeren", transcript: TRANSCRIPT })],
    }),
  );
  await import("../../src/config.ts");
  store = await import("../../src/store.js");
  ({ summarizeCall } = await import("../../src/claude.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

const RUECKRUF_PHRASEN = {
  de: ["Gegenseite um einen Rueckruf bittet", "rufen Sie mich morgen um 10 Uhr zurueck", "Typ callback"],
  en: ["other party asks to be called back", "call me back tomorrow at 10", "type callback"],
  fr: ["demande à être rappelée", "rappelez-moi demain à 10 heures", "type callback"],
};

for (const lang of ["de", "en", "fr"]) {
  test(`summarizeCall (${lang}) weist den Rueckrufwunsch der Gegenseite als callback an, at nur mit Zeitpunkt`, async () => {
    const call = store.getCall(CALL_ID);
    call.language = lang;
    try {
      await summarizeCall(call);
    } finally {
      call.language = "de";
    }
    for (const phrase of RUECKRUF_PHRASEN[lang]) {
      assert.ok(lastRequest.system.includes(phrase), `${lang}: "${phrase}" fehlt im Prompt`);
    }
  });
}
