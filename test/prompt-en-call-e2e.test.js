// PROMPT-03 + PROMPT-14 (tasks/i18n-tests/02-llm-prompts.md).
//
// Echter Server-Spawn (Muster helpers.js/g4-no-speech-reprompt.test.js): ein Tenant mit
// settings.language="en" durchlaeuft /voice/incoming (Greeting, PROMPT-03) UND /voice/turn
// (echter LLM-Roundtrip ueber einen lokalen Anthropic-Mock, der system/tools des
// TATSAECHLICHEN Request-Bodys aufzeichnet - KEIN Mock von systemPrompt()/toolDefs()
// selbst). PROMPT-14 zaehlt die deutschen Leck-Kanaele, die DIESER Block traegt
// (Greeting/Prompt-Geruest/toolDefs). Der SMS-/Notification-Kanal (PROMPT-12/PROMPT-13,
// src/telephony/call-finish.js) gehoert zu einem anderen Testkatalog-Block und fliesst
// hier NICHT in die Zaehlung ein (Scope-Begrenzung, siehe Phasenbericht).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState, OWNER_TEST_NUMBER } from "./helpers.js";

// EN-Greeting-Praefix (locale.greetingDefault, src/i18n/locales.js:249-250) - der
// SOLLZUSTAND, den settings.language="en" heute NICHT erreicht (Bug: settings.greeting
// bleibt der deutsche DEFAULT_GREETING, s. src/routes/voice.js:265).
const EN_GREETING_MARKER = /Hi, this is the AI assistant of/;

// Die fuenf deutschen Sektions-Ueberschriften des Prompt-Geruests (s. PROMPT-01).
const GERMAN_HEADINGS = [
  "SITUATION:",
  "SO SPRICHST DU:",
  "WENN ETWAS UNKLAR IST:",
  "DEINE GRENZEN:",
  "SO KOMMST DU ZUM ERGEBNIS:",
];

function textMessage(text) {
  return {
    id: "msg_prompt14",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 6 },
  };
}

// Fake-Anthropic-Server: zeichnet JEDEN Request-Body auf (system/tools-Assertion) und
// antwortet immer mit einer knappen Text-Antwort (kein Tool-Aufruf -> ein Roundtrip reicht).
async function startCapturingMock() {
  const bodies = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(textMessage("Alright, thank you for calling. Goodbye!")));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    bodies,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

test("Inbound-Greeting fuer einen EN-Tenant ist strukturell englisch (ex PROMPT-03)", async () => {
  const srv = await startServer({ seed: seedState({ settings: { language: "en" } }) });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({
        CallSid: "CAprompt03",
        From: "+15005550101",
        To: OWNER_TEST_NUMBER.e164,
      }),
    });
    const body = await res.text();
    assert.match(
      body,
      EN_GREETING_MARKER,
      `EN-Tenant bekommt weiterhin die deutsche Begruessung (Launch-Blocker): ${body}`,
    );
  } finally {
    await srv.stop();
  }
});

test("EN-Call ist frei von hartcodiertem Deutsch: Greeting + Prompt-Geruest + toolDefs (ex PROMPT-14)", async () => {
  const mock = await startCapturingMock();
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url },
    seed: seedState({ settings: { language: "en" } }),
  });
  try {
    const incomingRes = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({
        CallSid: "CAprompt14",
        From: "+15005550101",
        To: OWNER_TEST_NUMBER.e164,
      }),
    });
    const greeting = await incomingRes.text();

    const stored = srv.readStore();
    const call = stored.calls.find((c) => c.status === "active" && c.direction === "inbound");
    assert.ok(call, "Inbound-Call wurde nicht angelegt");

    const turnRes = await fetch(`${srv.localUrl}/voice/turn?callId=${call.id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "Hello, who is this?" }),
    });
    assert.equal(turnRes.status, 200);
    assert.equal(mock.bodies.length, 1, "genau ein LLM-Roundtrip erwartet (keine Tool-Nutzung)");
    const [reqBody] = mock.bodies;
    const promptText = reqBody.system.map((b) => b.text).join(" ");
    const toolDescriptions = reqBody.tools.map((t) => t.description).join(" ");

    let germanLeakCount = 0;
    if (!EN_GREETING_MARKER.test(greeting)) germanLeakCount += 1; // Greeting-Kanal
    if (GERMAN_HEADINGS.some((h) => promptText.includes(h))) germanLeakCount += 1; // Prompt-Geruest-Kanal
    if (/Beendet das Telefonat|Nimmt eine Nachricht/.test(toolDescriptions)) germanLeakCount += 1; // toolDefs-Kanal

    assert.equal(
      germanLeakCount,
      0,
      `EN-Call traegt in ${germanLeakCount}/3 der von diesem Block getragenen Kanaele hartcodiertes Deutsch (Launch-Blocker)`,
    );
  } finally {
    await srv.stop();
    await mock.close();
  }
});
