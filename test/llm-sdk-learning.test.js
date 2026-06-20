// Learning-Tests fuer das Drittanbieter-SDK @anthropic-ai/sdk 0.105 (Clean-Code P10).
// CP7 (P3b-R) bumpt das SDK 0.39 -> 0.105: node-fetch/agentkeepalive entfallen, der
// Client laeuft ueber native fetch (undici unter Node). Diese Tests nageln die
// Annahmen fest, gegen die der resiliente Seam (src/llm.js) gebaut ist - vor allem die
// NEUE Shape des "Premature close": unter 0.105 erscheint er als APIConnectionError
// mit verschachtelter cause-Kette (undici-Code UND_ERR_SOCKET), NICHT mehr als roher
// FetchError mit message "Premature close" wie unter 0.39.
//
// Reine node:test-Unit gegen einen lokalen http-Mock (Single-Consumer-Double, wie in
// outbound-premature-close.test.js) - KEIN App-Server-Spawn, KEIN pglite, KEIN echter
// API-Call: offline, deterministisch (P12 F.I.R.S.T., Build->Operate->Check P13). Eine
// eigene Datei statt Erweiterung von llm.test.js, weil L3/L4/L5 einen echten HTTP-
// Round-Trip durch das SDK brauchen, llm.test.js aber bewusst HTTP-/Spawn-frei ist.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { isTransient } from "../src/llm.js";

// Minimale, vollstaendige Anthropic-Message: der Seam-Konsument (claude.js) liest nur
// content + usage. Single-Consumer-Double -> lokal gehalten.
function anthropicMessage(text) {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 16 },
  };
}

// Bricht einen Response mitten im Body ab (Umbrella 5.1): chunked ohne Content-Length,
// ein Teil-Body, dann Socket-Destroy OHNE res.end() -> native fetch (undici) wirft den
// Premature close. Build-Schritt fuer L3/L4.
function endPremature(res) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.setHeader("transfer-encoding", "chunked");
  res.write('{"id":"msg_mock","type":"message"');
  res.socket.destroy();
}

// Antwortet valide mit einer kompletten Message (L5).
function endValid(res, text) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(anthropicMessage(text)));
}

// Lokaler Mock; `handler(res)` entscheidet pro Request ueber die Antwort. Body wird
// gedraint (sonst haengt das SDK auf dem Request-Stream).
async function startMock(handler) {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => handler(res));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

// Standard-Params fuer messages.create (Modell/Tokens egal - der Mock antwortet fix).
function createParams() {
  return { model: "claude-haiku-4-5", max_tokens: 10, messages: [{ role: "user", content: "hi" }] };
}

// L1: Der Default-Import + die Konstruktor-Optionen, die der Seam nutzt (apiKey,
// timeout, maxRetries), existieren und messages.create ist eine Funktion.
test("L-CP7-1: new Anthropic({apiKey,timeout,maxRetries}) + messages.create vorhanden", () => {
  const client = new Anthropic({ apiKey: "x", timeout: 3000, maxRetries: 0 });
  assert.equal(typeof client.messages.create, "function");
});

// L2: APIConnectionError ist als static am Default-Export verfuegbar (llm.js nutzt
// `err instanceof Anthropic.APIConnectionError`); instanceof greift fuer eine Instanz.
test("L-CP7-2: Anthropic.APIConnectionError ist eine Klasse, instanceof greift", () => {
  assert.equal(typeof Anthropic.APIConnectionError, "function");
  const err = new Anthropic.APIConnectionError({ message: "x" });
  assert.ok(err instanceof Anthropic.APIConnectionError);
});

// L3 (HERZSTUECK): Ein abgebrochener Body wirft unter 0.105 einen APIConnectionError,
// dessen verschachtelte cause-Kette den undici-Code UND_ERR_SOCKET traegt - die
// verifizierte neue SDK-Shape, gegen die isTransient gebaut ist.
test("L-CP7-3: abgebrochener Body -> APIConnectionError mit cause-Kette (neue SDK-Shape)", async () => {
  const mock = await startMock((res) => endPremature(res));
  try {
    const client = new Anthropic({ apiKey: "x", baseURL: mock.url, timeout: 3000, maxRetries: 0 });
    await assert.rejects(
      () => client.messages.create(createParams()),
      (err) => err instanceof Anthropic.APIConnectionError && err.cause?.cause?.code === "UND_ERR_SOCKET",
    );
  } finally {
    await mock.close();
  }
});

// L4: Der Seam-Klassifikator behandelt genau diese reale Shape als transient (sonst
// wuerde der Retry nicht mehr feuern und der Live-Bug kaeme zurueck).
test("L-CP7-4: isTransient(echter neuer Premature-close-Error) === true", async () => {
  const mock = await startMock((res) => endPremature(res));
  let captured;
  try {
    const client = new Anthropic({ apiKey: "x", baseURL: mock.url, timeout: 3000, maxRetries: 0 });
    try {
      await client.messages.create(createParams());
      assert.fail("erwartet: abgebrochener Body wirft");
    } catch (err) {
      captured = err;
    }
  } finally {
    await mock.close();
  }
  assert.equal(isTransient(captured), true);
});

// L5: Eine erfolgreiche Antwort liefert die von claude.js gelesene Shape -
// usage.{input_tokens,output_tokens} + content als Block-Array.
test("L-CP7-5: messages.create liefert {usage:{input_tokens,output_tokens}, content:[...]}", async () => {
  const speech = "Ich rufe im Auftrag an und haette eine kurze Frage.";
  const mock = await startMock((res) => endValid(res, speech));
  try {
    const client = new Anthropic({ apiKey: "x", baseURL: mock.url, timeout: 3000, maxRetries: 0 });
    const resp = await client.messages.create(createParams());
    assert.equal(typeof resp.usage.input_tokens, "number");
    assert.equal(typeof resp.usage.output_tokens, "number");
    assert.ok(Array.isArray(resp.content));
    assert.equal(resp.content[0].type, "text");
    assert.equal(resp.content[0].text, speech);
  } finally {
    await mock.close();
  }
});
