import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

function textOnly(text) {
  return {
    id: "msg_gqp8",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

let server;
let queue = [];
let bodies = [];
let store, defaults, claude, LOCALES, SUPPORTED_LANGUAGES;
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
  process.env.ANTHROPIC_API_KEY = "test-gqp8-key";
  process.env.IN_CALL_CONSULT_ENABLED = "true";
  process.env.CONSULT_ENABLED = "true";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  const calls = [];
  for (let i = 1; i <= 12; i++)
    calls.push(seedCall({ id: `call_gqp8_${i}`, direction: "outbound", answeredAt: null }));
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }],
      calls,
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  defaults = await import("../src/store/defaults.js");
  claude = await import("../src/claude.js");
  ({ LOCALES, SUPPORTED_LANGUAGES } = await import("../src/i18n/locales.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

function callWithArrivedAnswer(consultOverrides = {}) {
  callSeq += 1;
  const call = store.getCall(`call_gqp8_${callSeq}`);
  call.answeredAt = new Date(Date.now() - 600_000).toISOString();
  call.consults = [
    {
      id: "c0",
      seq: 0,
      status: defaults.CONSULT_STATUS.ANSWERED,
      askedAt: new Date(Date.now() - 20_000).toISOString(),
      answeredAt: new Date(Date.now() - 4_000).toISOString(),
      answeredFacts: 1,
      held: true,
      pendingNoted: true,
      ...consultOverrides,
    },
  ];
  return call;
}

const arrivalMarker = () => LOCALES.de.prompt.turnControl.consultAnswered;

test("GQ-P8-1: eingetroffene Antwort -> advanceInCallConsult meldet ANSWERED (statt NONE)", () => {
  const call = callWithArrivedAnswer();
  const wait = store.advanceInCallConsult(call.id, {
    nowMs: Date.now(),
    waitMs: 1_000,
    openMs: 300_000,
  });
  assert.equal(wait, defaults.CONSULT_WAIT.ANSWERED);
  assert.equal(store.getCall(call.id).consults[0].deliveredAt, undefined);
});

test("GQ-P8-2: bereits ausgelieferte Antwort meldet KEIN ANSWERED mehr", () => {
  const call = callWithArrivedAnswer({ deliveredAt: new Date().toISOString() });
  const wait = store.advanceInCallConsult(call.id, {
    nowMs: Date.now(),
    waitMs: 1_000,
    openMs: 300_000,
  });
  assert.notEqual(wait, defaults.CONSULT_WAIT.ANSWERED);
});

test("GQ-P8-3: der Turn traegt den Ankunfts-Steuertext am letzten user-Turn", async () => {
  const call = callWithArrivedAnswer();
  bodies = [];
  queue = [textOnly("Es ist ein VW Golf 7, Baujahr 2017, Diesel.")];

  const turn = await claude.agentTurn(call, "Und, welches Modell ist es nun?");

  assert.equal(turn.speech, "Es ist ein VW Golf 7, Baujahr 2017, Diesel.");
  assert.equal(bodies.length, 1, "normaler Modell-Turn, das Signal blockiert nichts");
  const lastMessage = bodies[0].messages.at(-1).content;
  assert.ok(
    lastMessage.endsWith(arrivalMarker()),
    "ohne diesen Marker sah das Modell dieselbe Hintergrund-Liste wie zuvor",
  );
});

test("GQ-P8-4: der Steuertext verbietet die drei live gemessenen Fehlreaktionen", () => {
  const marker = arrivalMarker();
  assert.match(marker, /HINTERGRUND/, "verweist auf den Ort der Antwort");
  assert.match(marker, /NICHT erneut nach/, "kein zweites Nachfragen");
  assert.match(marker, /KEINEN\s+Rückruf/, "kein angekuendigter Rueckruf");
  assert.match(marker, /KEINE Nachricht/, "kein take_message darueber");
});

test("GQ-P8-5: das Signal steht VOR pending/timeout - die Ankunft ist der staerkere Zustand", () => {
  const call = callWithArrivedAnswer();
  call.consults.push({
    id: "c1",
    seq: 1,
    status: defaults.CONSULT_STATUS.OPEN,
    askedAt: new Date().toISOString(),
    held: true,
  });
  const wait = store.advanceInCallConsult(call.id, {
    nowMs: Date.now(),
    waitMs: 1_000,
    openMs: 300_000,
  });
  assert.equal(wait, defaults.CONSULT_WAIT.ANSWERED);
});

test("GQ-P8-6: jede unterstuetzte Sprache traegt den Ankunfts-Steuertext", () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const marker = LOCALES[language].prompt.turnControl.consultAnswered;
    assert.equal(typeof marker, "string", `${language}: consultAnswered fehlt`);
    assert.ok(marker.startsWith("["), `${language}: Steuertext muss eckig geklammert sein`);
    assert.ok(marker.endsWith("]"), `${language}: Steuertext muss eckig geklammert sein`);
  }
});

test("GQ-P9-1: der Systemprompt verbietet, die Gegenstelle nach Auftraggeber-Angaben zu fragen", async () => {
  const { systemPrompt } = claude;
  const call = callWithArrivedAnswer();
  const prompt = systemPrompt(call);
  const owner = LOCALES.de.prompt.boundaries.noAskingCounterpartAboutOwner("Jonas Beispiel");

  assert.ok(prompt.includes("fragst du NIEMALS dein Gegenüber danach"), "Regel fehlt im Prompt");
  assert.match(owner, /NIEMALS dein Gegenüber/);
});

test("GQ-P9-2: die Regel steht in JEDEM Turn - sie haengt an keinem Flag und keinem Werkzeug", async () => {
  const withConsult = claude.systemPrompt(callWithArrivedAnswer());
  const plain = claude.systemPrompt(callWithArrivedAnswer({ status: "open", answeredAt: null }));
  for (const prompt of [withConsult, plain])
    assert.ok(prompt.includes("fragst du NIEMALS dein Gegenüber danach"));
});

test("GQ-P9-3: jede unterstuetzte Sprache traegt die Regel", () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const rule = LOCALES[language].prompt.boundaries.noAskingCounterpartAboutOwner;
    assert.equal(typeof rule, "function", `${language}: noAskingCounterpartAboutOwner fehlt`);
    const rendered = rule("Jonas Beispiel");
    assert.ok(rendered.startsWith("-"), `${language}: Grenzen-Zeile beginnt mit Spiegelstrich`);
    assert.ok(rendered.includes("Jonas Beispiel"), `${language}: Auftraggeber-Name eingesetzt`);
  }
});
