import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { seedCall, seedState, startServer, waitForStoreState } from "../helpers.js";

const HTTP_BAD_REQUEST = 400;
const JSON_HEADER = { "content-type": "application/json" };
const FRIST_MS = 15000;
const POLL_TAKT_MS = 100;
const BOOTSTRAP_TENANT = "owner";
const TENANT_MIT_ZUSAMMENFASSUNG = "t_3491_mit";
const PROVIDER_SUMMARY = "The assistant asked about prices and ended the call.";
const MODEL_SUMMARY = "Preis fuer 5 l Olivenoel erfragt: 64,50 Euro.";
const GOAL = "Preis fuer 5 l Olivenoel erfragen";

const MODEL_ANSWERS = {
  "Preis genannt": { summary: MODEL_SUMMARY, actionItems: [], objective_achieved: true },
  Aufgelegt: { summary: "Gegenueber legte auf.", actionItems: [], objective_achieved: false },
  Verbindungstest: { summary: "Verbindungstest.", actionItems: [], objective_achieved: "unclear" },
};

const FAELLE = {
  preis: {
    lines: [
      ["agent", "Preis fuer 5 l Olivenoel?"],
      ["user", "Preis genannt: 64,50 Euro"],
    ],
    erfolg: "failure",
  },
  aufgelegt: {
    lines: [
      ["agent", "Hallo?"],
      ["user", "Aufgelegt"],
    ],
    erfolg: "success",
  },
  test: {
    lines: [
      ["agent", "Hallo"],
      ["user", "Verbindungstest"],
    ],
    erfolg: "failure",
  },
  aus: {
    lines: [
      ["agent", "Hallo"],
      ["user", "Preis genannt"],
    ],
    erfolg: "failure",
  },
  fehler: {
    lines: [
      ["agent", "Hallo"],
      ["user", "Preis genannt MODELLFEHLER"],
    ],
    erfolg: "success",
  },
};

const conversationOf = (name) => ({
  conversation_id: `conv_${name}`,
  status: "done",
  transcript: FAELLE[name].lines.map(([role, message]) => ({ role, message })),
  analysis: { call_successful: FAELLE[name].erfolg, transcript_summary: PROVIDER_SUMMARY },
  metadata: {
    call_duration_secs: 30,
    phone_call: { direction: "outbound", call_id: `otb_${name}` },
  },
});

const modelReply = (text) => ({
  id: "msg_3491",
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5",
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 20, output_tokens: 30 },
});

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((bereit) => server.listen(0, "127.0.0.1", () => bereit(server)));
}

let model;
let elevenLabs;
let srv;
let stand;
let modelCallsOfOtherTenant = 0;

before(async () => {
  model = await listen((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (body.includes("Eva Beispiel")) modelCallsOfOtherTenant += 1;
      if (body.includes("MODELLFEHLER")) {
        res.writeHead(HTTP_BAD_REQUEST, JSON_HEADER).end("{}");
        return;
      }
      res.setHeader("content-type", "application/json");
      const key = Object.keys(MODEL_ANSWERS).find((k) => body.includes(k));
      res.end(JSON.stringify(modelReply(JSON.stringify(MODEL_ANSWERS[key]))));
    });
  });
  elevenLabs = await listen((req, res) => {
    const name = req.url.slice(req.url.lastIndexOf("/") + 1).replace("conv_", "");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(FAELLE[name] ? conversationOf(name) : {}));
  });
  const calls = Object.keys(FAELLE).map((n) =>
    seedCall({
      id: `call_3491_${n}`,
      tenantId: n === "aus" ? BOOTSTRAP_TENANT : TENANT_MIT_ZUSAMMENFASSUNG,
      goal: GOAL,
      elevenlabsConversationId: `conv_${n}`,
      answeredAt: new Date().toISOString(),
    }),
  );
  srv = await startServer({
    env: {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${model.address().port}`,
      ANTHROPIC_API_KEY: "test-3491-key",
      ELEVENLABS_API_BASE: `http://127.0.0.1:${elevenLabs.address().port}`,
      ELEVENLABS_API_KEY: "test-key",
      ELEVENLABS_RESULT_POLL_MS: String(POLL_TAKT_MS),
    },
    seed: seedState({
      tenants: [
        { id: BOOTSTRAP_TENANT, status: "active", ownerName: "Eva Beispiel" },
        { id: TENANT_MIT_ZUSAMMENFASSUNG, status: "active", ownerName: "Jonas Beispiel" },
      ],
      settings: { allowSummaries: false },
      calls,
    }),
  });
  stand = await waitForStoreState(
    srv,
    (s) =>
      s.calls.every(
        (c) =>
          (c.billedAt && s.notifications.some((m) => m.callId === c.id)) ||
          (c.billedAt && c.id === "call_3491_aus"),
      ),
    FRIST_MS,
  );
});

after(async () => {
  await srv.stop();
  await new Promise((r) => model.close(r));
  await new Promise((r) => elevenLabs.close(r));
});

const callOf = (name) => stand.calls.find((c) => c.id === `call_3491_${name}`);

test("Preis erfragt und genannt, kein Termin, Anbieter meldet failure: Ziel erreicht und Ergebniskarte", () => {
  assert.equal(callOf("preis").objectiveAchieved, true);
  assert.equal(callOf("preis").summary, MODEL_SUMMARY);
});

test("Gegenueber legt auf, Anbieter meldet success: Ziel nicht erreicht", () => {
  assert.equal(callOf("aufgelegt").objectiveAchieved, false);
});

test("Verbindungstest ohne Ziel, Anbieter meldet failure: nie false", () => {
  assert.notEqual(callOf("test").objectiveAchieved, false);
});

test("Zusammenfassungen aus: kein Modellaufruf, failure allein erzeugt kein false, Anbieter-Text bleibt", () => {
  assert.equal(modelCallsOfOtherTenant, 0);
  assert.equal(callOf("aus").objectiveAchieved, "unclear");
  assert.equal(callOf("aus").summary, PROVIDER_SUMMARY);
});

test("Modell faellt aus: Anbieter-Text bleibt, Ziel unclear", () => {
  assert.equal(callOf("fehler").objectiveAchieved, "unclear");
  assert.equal(callOf("fehler").summary, PROVIDER_SUMMARY);
});
