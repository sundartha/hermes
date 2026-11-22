import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";

const OWNER = "Jonas Beispiel";
const CALL_ID = "call_5995_rueckruf";

const TRANSCRIPT = [
  { role: "agent", text: "Ich rufe im Auftrag von Jonas Beispiel an." },
  { role: "caller", text: "Ich bin gerade busy, rufen Sie mich morgen um 10 Uhr zurück." },
];

function anthropicMessage() {
  return {
    id: "msg_5995_mock",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [
      { type: "text", text: JSON.stringify({ summary: "Rückruf erbeten.", actionItems: [] }) },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 30 },
  };
}

const PHRASEN = {
  de: [
    'Bittet die Gegenseite um einen Rueckruf, ist das ein Schritt vom Typ "callback"; der Zeitpunkt der Bitte kommt nach "at", sobald er genannt wurde.',
  ],
  en: [
    'If the other party asks to be called back, that is a step of type "callback"; the requested time goes into "at" as soon as it was stated.',
  ],
  fr: [
    'Si l\'interlocuteur demande à être rappelé, c\'est une étape de type "callback" ; le moment demandé va dans "at" dès qu\'il est indiqué.',
  ],
};

let server;
let lastRequest = null;
let summarizeCall, store;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      lastRequest = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(anthropicMessage()));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-5995-key";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls: [
        seedCall({
          id: CALL_ID,
          direction: "outbound",
          goal: "Termin klären",
          transcript: TRANSCRIPT,
        }),
      ],
    }),
  );
  await import("../../src/config.ts");
  store = await import("../../src/store.js");
  ({ summarizeCall } = await import("../../src/claude.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

for (const lang of ["de", "en", "fr"]) {
  test(`summarizeCall (${lang}) weist den Rueckrufwunsch der Gegenseite als callback an`, async () => {
    const call = store.getCall(CALL_ID);
    call.language = lang;
    try {
      await summarizeCall(call);
    } finally {
      call.language = "de";
    }
    assert.ok(lastRequest.messages[0].content.includes("rufen Sie mich morgen um 10 Uhr zurück"));
    for (const phrase of PHRASEN[lang]) {
      assert.ok(lastRequest.system.includes(phrase), `${lang}: "${phrase}" fehlt im Prompt`);
    }
  });
}
