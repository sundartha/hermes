// CP4 (P3b-R, call-debug-p3b-r.md): End-to-end-Verhalten des Outbound-/Turn-Pfads
// gegen einen flackernden Anthropic-Upstream ("Premature close" = chunked-Body wird
// vom Server abgebrochen). Pinnt fuer BEIDE Provider (Twilio + Telnyx):
//   A - /voice/outbound ist LLM-frei: Offenlegung + <Gather>, kein LLM-Call (kein
//       [outbound]/[outbound-recv]-Log mehr) - der Strukturfix (Schicht 1).
//   B - der resiliente Seam (src/llm.js) retriet im ersten /voice/turn begrenzt und
//       liefert dann das Anliegen (Schicht 2 greift, kein terminaler Fehler).
//   C - bei anhaltender Nichtverfuegbarkeit wirft der Seam LlmUnavailableError; der
//       /voice/turn-catch verabschiedet sich wuerdevoll (Say + Hangup), kein nacktes
//       "technisches Problem".
//   D - ein nicht-transienter 400 wird NICHT retried; der /voice/turn-catch rendert
//       das generische technische Ende, NICHT die Degradation (kein Fehlgriff).
//
// agentTurn ruft Anthropic ueber das SDK; statt das Netz zu treffen lenken wir den
// Client per ANTHROPIC_BASE_URL auf einen lokalen Mock (deterministisch, offline).
// Da /voice/outbound LLM-frei ist, treffen B/C/D den Seam erst ueber den ERSTEN
// /voice/turn (mit SpeechResult) - die Kette ist daher zweistufig.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState, seedCall } from "./helpers.js";

const CALL_ID = "call_premature1";
// Praefix des fest verdrahteten Offenlegungssatzes (disclosureSentence, claude.js):
// callerName ist null -> ownerName = OWNER_NAME aus dem Test-Env ("Jonas").
const DISCLOSURE = "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas.";
// Agent-Anliegen, das der Mock nach erfolgreichem (Retry-)Call liefert.
const AGENT_SPEECH = "Ich rufe im Auftrag von Jonas an und haette eine kurze Frage.";
const GATHER = "<Gather";
const HANGUP = "<Hangup";
// Teilstring von LLM_DEGRADED_SPEECH (server.js): pinnt die wuerdevolle Degradation.
const LLM_DEGRADED_MARKER = "Ich melde mich, sobald es wieder moeglich ist";
// Teilstring von TURN_ERROR_SPEECH (server.js): pinnt das generische technische Ende.
const TURN_ERROR_MARKER = "technisches Problem";

// Minimale, aber vollstaendige Anthropic-Message: agentTurn liest nur content +
// usage (usage ist PFLICHT, sonst wirft trackUsage). Single-Consumer-Double -> lokal.
function anthropicMessage(content) {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 16 },
  };
}

// Bricht einen Response als "Premature close" ab (Umbrella 5.1): chunked ohne
// Content-Length, ein Teil-Body, dann Socket-Destroy OHNE res.end() -> das SDK 0.39
// liest den Body als FetchError "Premature close" (transient, isTransient -> retry).
function endPremature(res) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.setHeader("transfer-encoding", "chunked");
  res.write('{"id":"msg_mock","type":"message"');
  res.socket.destroy();
}

// Antwortet valide mit dem Agent-Anliegen.
function endValid(res) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(anthropicMessage([{ type: "text", text: AGENT_SPEECH }])));
}

// Zaehlender Mock: bricht die ersten `failFirst` Requests mit Premature close ab,
// danach valide Antwort. count() = Anzahl gesehener Requests. Body wird gedraint.
async function startCountingAnthropicMock({ failFirst }) {
  let seen = 0;
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      seen += 1;
      if (seen <= failFirst) return endPremature(res);
      return endValid(res);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    count: () => seen,
    close: () => new Promise((r) => server.close(r)),
  };
}

// Bricht JEDEN Request mit Premature close ab (anhaltende Nichtverfuegbarkeit).
async function startAlwaysPrematureMock() {
  let seen = 0;
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      seen += 1;
      endPremature(res);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    count: () => seen,
    close: () => new Promise((r) => server.close(r)),
  };
}

// Antwortet immer 400 invalid_request (nicht-transient -> KEIN Retry im Seam).
async function startAlways4xxMock() {
  let seen = 0;
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      seen += 1;
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "mock-fehler" } }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    count: () => seen,
    close: () => new Promise((r) => server.close(r)),
  };
}

// Zwei-Schritt-Kette: /voice/outbound (LLM-frei) -> /voice/turn (LLM-getrieben).
// env-Override (z.B. LLM_MAX_RETRIES) wird an den Server durchgereicht. Server + Mock
// werden immer geschlossen. Liefert die beiden Bodies, den Turn-Status und stdout.
async function outboundThenTurn({ mockUrl, provider, speechResult, env = {} }) {
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mockUrl, ...env },
    seed: seedState({
      calls: [seedCall({ id: CALL_ID, provider, status: "active", direction: "outbound" })],
    }),
  });
  try {
    const outRes = await fetch(`${srv.localUrl}/voice/outbound?callId=${CALL_ID}`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest" }),
    });
    assert.equal(outRes.status, 200);
    const outboundBody = await outRes.text();

    const turnRes = await fetch(`${srv.localUrl}/voice/turn?callId=${CALL_ID}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: speechResult }),
    });
    const turnBody = await turnRes.text();
    return { outboundBody, turnBody, turnStatus: turnRes.status, stdout: srv.stdout };
  } finally {
    await srv.stop();
  }
}

// Disclosure muss als erster gesprochener Satz VOR dem Folge-Knoten stehen (Regel 2).
function assertDisclosureBefore(body, marker) {
  const discIdx = body.indexOf(DISCLOSURE);
  const markerIdx = body.indexOf(marker);
  assert.ok(discIdx !== -1, `Offenlegung fehlt im Body: ${body}`);
  assert.ok(markerIdx !== -1, `Marker '${marker}' fehlt im Body: ${body}`);
  assert.ok(discIdx < markerIdx, `Offenlegung muss VOR '${marker}' stehen: ${body}`);
}

for (const provider of ["twilio", "telnyx"]) {
  // A - /voice/outbound ist LLM-frei: Offenlegung + <Gather>, KEIN LLM-Call.
  test(`A (${provider}): /voice/outbound ist LLM-frei (Offenlegung + Gather, kein [outbound]-Log)`, async () => {
    const mock = await startCountingAnthropicMock({ failFirst: 1 });
    try {
      const { outboundBody, stdout } = await outboundThenTurn({ mockUrl: mock.url, provider, speechResult: "Hallo" });
      assertDisclosureBefore(outboundBody, GATHER);
      assert.ok(!outboundBody.includes(HANGUP), `/voice/outbound darf nicht auflegen: ${outboundBody}`);
      // LLM-frei -> nur die Offenlegung, kein Anliegen aus dem Mock.
      assert.ok(!outboundBody.includes(AGENT_SPEECH), `/voice/outbound darf kein Anliegen rendern (LLM-frei): ${outboundBody}`);
      // Strukturfix-Diskriminator: keine Outbound-LLM-Diagnose-Logs mehr.
      assert.ok(!stdout.includes("[outbound]"), `/voice/outbound macht keinen LLM-Call mehr (kein [outbound]-Log): ${stdout}`);
      assert.ok(!stdout.includes("[outbound-recv]"), `/voice/outbound macht keinen LLM-Call mehr (kein [outbound-recv]-Log): ${stdout}`);
    } finally {
      await mock.close();
    }
  });

  // B - Resilienz greift: der Seam retriet im ersten /voice/turn und liefert dann das
  // Anliegen. LLM_MAX_RETRIES=2 (BASE_ENV) -> 2 Aborts + 1 Erfolg = 3 Requests.
  test(`B (${provider}): Seam retriet -> Anliegen im /voice/turn, kein terminaler Fehler`, async () => {
    const mock = await startCountingAnthropicMock({ failFirst: 2 });
    try {
      const { turnBody, stdout } = await outboundThenTurn({ mockUrl: mock.url, provider, speechResult: "Hallo" });
      assert.ok(turnBody.includes(GATHER), `Turn nach Retry muss <Gather> rendern: ${turnBody}`);
      assert.ok(turnBody.includes(AGENT_SPEECH), `Anliegen fehlt nach erfolgreichem Retry: ${turnBody}`);
      assert.ok(!turnBody.includes(HANGUP), `geglueckter Turn darf nicht auflegen: ${turnBody}`);
      // Diskriminator: kein terminaler Turn-Error -> der interne Retry hat gegriffen.
      assert.ok(!stdout.includes("[turn]"), `kein terminaler Turn-Fehler erwartet (Retry greift): ${stdout}`);
      // 2 Aborts + 1 Erfolg = begrenzter Retry.
      assert.equal(mock.count(), 3, "erwartet 2 Aborts + 1 Erfolg = 3 Requests");
    } finally {
      await mock.close();
    }
  });

  // C - Degradation: anhaltende Nichtverfuegbarkeit -> LlmUnavailableError -> der
  // /voice/turn-catch verabschiedet sich wuerdevoll (Say + Hangup), kein nacktes
  // "technisches Problem". LLM_MAX_RETRIES=0 -> complete wirft direkt beim ersten
  // transienten Fehler (retries-exhausted), deterministisch + schnell (kein Backoff).
  test(`C (${provider}): anhaltend nicht verfuegbar -> wuerdevolle Degradation + Hangup`, async () => {
    const mock = await startAlwaysPrematureMock();
    try {
      const { turnBody } = await outboundThenTurn({
        mockUrl: mock.url,
        provider,
        speechResult: "Hallo",
        env: { LLM_MAX_RETRIES: "0" },
      });
      assert.ok(turnBody.includes(LLM_DEGRADED_MARKER), `Degradations-Text fehlt: ${turnBody}`);
      assert.ok(turnBody.includes(HANGUP), `Degradation muss kontrolliert auflegen: ${turnBody}`);
      // Diskriminator Degradation vs. generischer Fehler.
      assert.ok(!turnBody.includes(TURN_ERROR_MARKER), `Degradation darf nicht das generische Ende rendern: ${turnBody}`);
    } finally {
      await mock.close();
    }
  });

  // D - selektiv: ein 400 ist NICHT transient -> KEIN Retry, complete wirft den
  // Original-Fehler (kein LlmUnavailableError) -> der /voice/turn-catch rendert das
  // generische technische Ende, NICHT die Degradation. count===1 = kein Over-Retry.
  test(`D (${provider}): 400 wird nicht retried -> technisches Ende, keine Degradation`, async () => {
    const mock = await startAlways4xxMock();
    try {
      const { turnBody } = await outboundThenTurn({ mockUrl: mock.url, provider, speechResult: "Hallo" });
      assert.ok(turnBody.includes(TURN_ERROR_MARKER), `generisches technisches Ende fehlt: ${turnBody}`);
      assert.ok(!turnBody.includes(LLM_DEGRADED_MARKER), `400 darf nicht als Degradation enden: ${turnBody}`);
      assert.ok(turnBody.includes(HANGUP), `technisches Ende muss auflegen: ${turnBody}`);
      // Waechter gegen Over-Retry (Pre-Mortem: Over-Retry maskiert Config-Fehler).
      assert.equal(mock.count(), 1, "400 darf genau EINMAL angefragt werden (kein Retry)");
    } finally {
      await mock.close();
    }
  });
}
