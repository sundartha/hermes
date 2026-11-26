import assert from "node:assert/strict";
import http from "node:http";
import { test, before, after } from "node:test";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";
import { ergebnisZustand } from "../../src/telephony/ergebnis-zustand.ts";
import { seedCall, seedState, startServer, waitForStoreState } from "../helpers.js";

const FRIST_MS = 15000;
const POLL_TAKT_MS = 100;
const TENANT = "t_4059_ende";
const GOAL = "Termin am Dienstag um 10 Uhr vereinbaren";
const OUTBOUND_EL = { costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI };

const FAELLE = {
  bestaetigt: {
    antwort: "Ja, Dienstag um 10 Uhr passt, ist eingetragen.",
    modell: { objective_achieved: true, confirmed_by_counterparty: true, confirmation_quote: "Dienstag um 10 Uhr passt" },
    erwartet: ["done_confirmed", null],
  },
  ohneBestaetigung: {
    antwort: "Ich schaue mal nach.",
    modell: { objective_achieved: true },
    erwartet: ["unconfirmed", null],
  },
  abgelehnt: {
    antwort: "Nein, das vergeben wir nicht.",
    modell: { objective_achieved: false, declined: true },
    erwartet: ["not_done", "declined"],
  },
};

const conversationOf = (name) => ({
  conversation_id: `conv_${name}`,
  status: "done",
  transcript: [
    { role: "agent", message: "Passt Ihnen Dienstag um 10 Uhr?" },
    { role: "user", message: FAELLE[name].antwort },
  ],
  analysis: { call_successful: "success", transcript_summary: "Anbieter." },
  metadata: { call_duration_secs: 30, phone_call: { direction: "outbound", call_id: `otb_${name}` } },
});

const modelReply = (text) => ({
  id: "msg_4059",
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5",
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 20, output_tokens: 30 },
});

const listen = (handler) =>
  new Promise((bereit) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => bereit(server));
  });

let model;
let elevenLabs;
let srv;
let stand;
const systemPrompts = [];

before(async () => {
  model = await listen((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      systemPrompts.push(JSON.parse(body).system);
      const name = Object.keys(FAELLE).find((key) => body.includes(FAELLE[key].antwort));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(modelReply(JSON.stringify({ summary: "Zusammenfassung.", actionItems: [], ...FAELLE[name].modell }))));
    });
  });
  elevenLabs = await listen((req, res) => {
    const name = req.url.slice(req.url.lastIndexOf("/") + 1).replace("conv_", "");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(FAELLE[name] ? conversationOf(name) : {}));
  });
  const calls = Object.keys(FAELLE).map((name) =>
    seedCall({
      ...OUTBOUND_EL,
      id: `call_4059_ende_${name}`,
      tenantId: TENANT,
      goal: GOAL,
      elevenlabsConversationId: `conv_${name}`,
      answeredAt: new Date().toISOString(),
      fristAbfrageAt: new Date().toISOString(),
    }),
  );
  srv = await startServer({
    env: {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${model.address().port}`,
      ANTHROPIC_API_KEY: "test-4059-key",
      ELEVENLABS_API_BASE: `http://127.0.0.1:${elevenLabs.address().port}`,
      ELEVENLABS_API_KEY: "test-key",
      ELEVENLABS_RESULT_POLL_MS: String(POLL_TAKT_MS),
      FRISTEN_TAKT_MS: "40",
    },
    seed: seedState({
      tenants: [{ id: TENANT, status: "active", ownerName: "Jonas Beispiel" }],
      settings: { allowSummaries: true },
      calls,
    }),
  });
  stand = await waitForStoreState(
    srv,
    (s) => s.calls.every((c) => c.billedAt && s.notifications.some((m) => m.callId === c.id)),
    FRIST_MS,
  );
});

after(async () => {
  await srv.stop();
  await new Promise((r) => model.close(r));
  await new Promise((r) => elevenLabs.close(r));
});

for (const [name, fall] of Object.entries(FAELLE)) {
  test(`Anrufende 4059: ${name}`, () => {
    const call = stand.calls.find((c) => c.id === `call_4059_ende_${name}`);
    const ergebnis = ergebnisZustand(call);
    assert.deepEqual([ergebnis.result_state, ergebnis.result_reason], fall.erwartet);
  });
}

test("Anrufende 4059: der Auswertungsauftrag verlangt Bestaetigung, Zitat und Ablehnung", () => {
  assert.ok(systemPrompts.length > 0);
  for (const system of systemPrompts) {
    for (const feld of ["confirmed_by_counterparty", "confirmation_quote", "declined"]) {
      assert.ok(String(system).includes(feld), `${feld} fehlt im Auftrag`);
    }
  }
});
