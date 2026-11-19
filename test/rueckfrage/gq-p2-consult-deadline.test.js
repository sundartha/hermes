import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";

const QUESTION = "Darf ich den Termin auch auf Freitag legen?";
function message(content, stopReason) {
  return {
    id: "msg_gqp2",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}
const textOnly = (text) => message([{ type: "text", text }], "end_turn");
let server;
let queue = [];
let bodies = [];
let store, defaults, claude, inCall, delivery, config, LOCALES, SUPPORTED_LANGUAGES;
let callSeq = 0;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(queue.shift() || textOnly("UNGEWOLLTER-ZUSATZ-ROUNDTRIP")));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-gqp2-key";
  process.env.IN_CALL_CONSULT_ENABLED = "true";
  process.env.CONSULT_ENABLED = "true";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  const calls = [];
  for (let i = 1; i <= 30; i++) {
    calls.push(seedCall({ id: `call_gqp2_${i}`, direction: "outbound", answeredAt: null }));
  }
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }],
      calls,
    }),
  );
  ({ config } = await import("../../src/config.js"));
  store = await import("../../src/store.js");
  defaults = await import("../../src/begriffe/rueckfrage.js");
  claude = await import("../../src/claude.js");
  inCall = await import("../../src/consult/in-call.js");
  delivery = await import("../../src/consult/delivery.js");
  ({ LOCALES, SUPPORTED_LANGUAGES } = await import("../../src/i18n/locales.ts"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

function nextCall() {
  callSeq += 1;
  return store.getCall(`call_gqp2_${callSeq}`);
}

function inCallReadyCall() {
  const call = nextCall();
  call.answeredAt = new Date(Date.now() - 600_000).toISOString();
  return call;
}

function endCall(call) {
  call.status = "ended";
  return call;
}

test("GQ-P2-1: eine Antwort nach ~10 s wird angenommen und landet im HINTERGRUND", () => {
  const call = inCallReadyCall();
  store.emitConsult(call.id, [QUESTION]);
  const stored = store.getCall(call.id);
  stored.consults[0].askedAt = new Date(Date.now() - 10_000).toISOString();
  const eventId = stored.consults[0].id;
  const { outcome, mergedFacts } = inCall.acceptConsultAnswer(stored, {
    eventId,
    facts: ["Freitag passt auch"],
  });
  assert.equal(outcome, defaults.CONSULT_ANSWER.ACCEPTED);
  assert.ok(mergedFacts >= 1);
  assert.match(claude.systemPrompt(store.getCall(call.id)), /Freitag passt auch/);

  const call2 = inCallReadyCall();
  store.emitConsult(call2.id, [QUESTION]);
  const stored2 = store.getCall(call2.id);
  stored2.consults[0].askedAt = new Date(Date.now() - inCall.CONSULT_OPEN_MS - 1).toISOString();
  const eventId2 = stored2.consults[0].id;
  const before = JSON.stringify(stored2.context?.key_facts || []);
  const rejected = inCall.acceptConsultAnswer(stored2, { eventId: eventId2, facts: ["Zu spaet"] });
  assert.equal(rejected.outcome, defaults.CONSULT_ANSWER.DEADLINE_PASSED);
  assert.equal(rejected.mergedFacts, 0);
  assert.equal(JSON.stringify(store.getCall(call2.id).context?.key_facts || []), before);
  endCall(store.getCall(call.id));
  endCall(store.getCall(call2.id));
});

test("GQ-P2-2: nach Ablauf der Offen-Frist bleibt die Antwort draussen (fail-closed)", () => {
  const call = inCallReadyCall();
  store.emitConsult(call.id, [QUESTION]);
  const stored = store.getCall(call.id);
  stored.consults[0].askedAt = new Date(Date.now() - inCall.CONSULT_OPEN_MS - 1).toISOString();
  const res = inCall.acceptConsultAnswer(stored, {
    eventId: stored.consults[0].id,
    facts: ["X"],
  });
  assert.equal(res.outcome, defaults.CONSULT_ANSWER.DEADLINE_PASSED);

  const call2 = inCallReadyCall();
  store.emitConsult(call2.id, [QUESTION]);
  const stored2 = store.getCall(call2.id);
  const res2 = store.answerConsult(stored2.id, {
    eventId: stored2.consults[0].id,
    facts: ["Y"],
    nowMs: Date.now(),
    openMs: undefined,
  });
  assert.equal(res2.outcome, defaults.CONSULT_ANSWER.DEADLINE_PASSED);

  const call3 = nextCall();
  const askedBeforePickup = new Date(Date.now() - 3_600_000).toISOString();
  store.emitConsult(call3.id, [QUESTION]);
  const stored3 = store.getCall(call3.id);
  stored3.consults[0].askedAt = askedBeforePickup;
  stored3.answeredAt = new Date().toISOString();
  const res3 = store.answerConsult(stored3.id, {
    eventId: stored3.consults[0].id,
    facts: ["Ring-Time-Antwort"],
    nowMs: Date.now(),
    openMs: 1,
  });
  assert.equal(res3.outcome, defaults.CONSULT_ANSWER.ACCEPTED);
  endCall(store.getCall(call.id));
  endCall(store.getCall(call2.id));
  endCall(store.getCall(call3.id));
});

const FALSE_CAPABILITY_DENYLIST =
  /kein[e]? (Funktion|Möglichkeit)|not able to|no (function|way) to|aucune (fonction|possibilité)/i;

test("GQ-P2-4: kein Ueberbrueckungstext behauptet eine fehlende Faehigkeit", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const tc = LOCALES[lang].prompt.turnControl;
    assert.doesNotMatch(
      tc.consultPending,
      FALSE_CAPABILITY_DENYLIST,
      `${lang}: consultPending behauptet eine fehlende Faehigkeit`,
    );
    assert.doesNotMatch(
      tc.consultTimeout,
      FALSE_CAPABILITY_DENYLIST,
      `${lang}: consultTimeout behauptet eine fehlende Faehigkeit`,
    );
  }
  assert.match(
    "Ich habe leider keine Funktion, um das zu konsultieren.",
    FALSE_CAPABILITY_DENYLIST,
  );
});

test("GQ-P2-5: die Offen-Frist traegt zwei volle Poll-Zyklen", () => {
  assert.ok(
    config.tenancy.consultOpenMs >= 2 * delivery.CONSULT_POLL_HOLD_MS,
    "consultOpenMs deckt zwei Long-Poll-Zyklen nicht ab",
  );
  assert.ok(
    config.tenancy.consultOpenMs > inCall.CONSULT_WAIT_MS,
    "Offen-Frist muss laenger sein als die Warte-Frist",
  );
  assert.ok(!(inCall.CONSULT_WAIT_MS >= config.tenancy.consultOpenMs));
});

