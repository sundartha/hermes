// Phase P0 (docs/strategy/call-debug.md): Offline-Reproduktion der "No-Gather"-
// Mechanik des Outbound-Antwort-Webhooks. Pinnt fuer BEIDE Provider (Twilio +
// Telnyx) drei Faelle des /voice/outbound-Pfads (server.js:506-513):
//   (i)  normaler Turn   -> Body enthaelt <Gather> NACH dem Disclosure (AK-1).
//   (ii) endCall=true     -> Body enthaelt KEIN <Gather> (heutiger Bug, als
//        dokumentierte Regression: der Agent legt nach einem Satz auf, Trigger T1).
//   (iii) agentTurn wirft -> Disclosure + Hangup ohne <Gather> (Trigger T2).
//
// agentTurn ruft Anthropic ueber das SDK auf. Statt das Netz zu treffen, lenken
// wir den Client per ANTHROPIC_BASE_URL (SDK-Default Core.readEnv, claude.js:9)
// auf einen lokalen Mock - kein src/-Eingriff, deterministisch und offline. Der
// Mock liefert je Fall genau eine Antwort (agentTurn ruft pro Fall genau einmal).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState, seedCall } from "./helpers.js";

const CALL_ID = "call_outbound1";
// Praefix des fest verdrahteten Offenlegungssatzes (disclosureSentence, claude.js):
// callerName ist null -> ownerName = OWNER_NAME aus dem Test-Env ("Jonas"). Der Satz
// enthaelt keine XML-Sonderzeichen, steht also in TwiML wie TeXML wortgleich im Body.
const DISCLOSURE = "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas.";
// Agent-Anliegen im Normal-Turn (im <Gather>-Prompt gerendert).
const AGENT_SPEECH = "Ich rufe im Auftrag von Jonas an und haette eine kurze Frage.";
// Abschiedssatz, den der Agent vor end_call sagt (zweiter <Say> im endCall-Body).
const FAREWELL = "Vielen Dank, das war schon alles. Auf Wiederhoeren!";

// Minimale, aber vollstaendige Anthropic-Message: agentTurn liest nur content +
// usage (usage ist PFLICHT, sonst wirft trackUsage und der Fall faellt faelschlich
// in den catch). stop_reason ist kosmetisch, wird aber realistisch gesetzt.
function anthropicMessage(content, stopReason) {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 16 },
  };
}

// behavior -> { status, body }. "throw" liefert 400: das SDK wiederholt 400 NICHT
// (nur 408/409/429/5xx/Verbindungsfehler) -> agentTurn wirft sofort, kein Retry-Delay.
function anthropicResponse(behavior) {
  switch (behavior) {
    case "normal":
      return { status: 200, body: anthropicMessage([{ type: "text", text: AGENT_SPEECH }], "end_turn") };
    case "endCall":
      // Text + end_call in EINER Antwort: speech wird gesetzt, dann bricht der
      // Tool-Loop ab (claude.js:222-225) -> genau ein Mock-Aufruf.
      return {
        status: 200,
        body: anthropicMessage(
          [
            { type: "text", text: FAREWELL },
            { type: "tool_use", id: "toolu_mock", name: "end_call", input: {} },
          ],
          "tool_use"
        ),
      };
    case "throw":
      return { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "mock-fehler" } } };
    default:
      throw new Error(`unbekanntes behavior: ${behavior}`);
  }
}

// Lokaler Anthropic-Messages-Mock: antwortet auf JEDEN Request identisch (Pfad
// egal; das SDK postet /v1/messages). Request-Body wird gedraint, damit die
// Verbindung nicht haengt. Single-Consumer-Double -> bewusst lokal, nicht in helpers.js.
async function startAnthropicMock(behavior) {
  const { status, body } = anthropicResponse(behavior);
  const payload = JSON.stringify(body);
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(payload);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

// Faehrt /voice/outbound lokal gegen den gefakten agentTurn und liefert den
// gerenderten Provider-Body (TwiML/TeXML). Mock + Server werden immer geschlossen.
async function outboundBody({ provider, behavior }) {
  const mock = await startAnthropicMock(behavior);
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url },
    seed: seedState({
      calls: [seedCall({ id: CALL_ID, provider, status: "active", direction: "outbound" })],
    }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/voice/outbound?callId=${CALL_ID}`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest" }),
    });
    assert.equal(res.status, 200);
    // Der Pfad pinnt Provider-Markup -> die Antwort muss auch wirklich XML sein.
    assert.ok(res.headers.get("content-type")?.includes("text/xml"), `Antwort ist kein XML: ${res.headers.get("content-type")}`);
    return await res.text();
  } finally {
    await srv.stop();
    await mock.close();
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

// Beide Renderer oeffnen den Sprach-Turn mit "<Gather" (Twilio-TwiML + Telnyx-TeXML).
const GATHER = "<Gather";
const HANGUP = "<Hangup";

for (const provider of ["twilio", "telnyx"]) {
  test(`/voice/outbound (${provider}): normaler Turn rendert <Gather> nach der Offenlegung (AK-1)`, async () => {
    const body = await outboundBody({ provider, behavior: "normal" });
    assertDisclosureBefore(body, GATHER);
    assert.ok(body.includes(AGENT_SPEECH), `Anliegen fehlt im Gather-Prompt: ${body}`);
    // Kein Hangup: der Call bleibt nach dem ersten Satz offen (kein Sofort-Auflegen).
    assert.ok(!body.includes(HANGUP), `Normaler Turn darf nicht auflegen: ${body}`);
  });

  test(`/voice/outbound (${provider}): endCall=true rendert KEIN <Gather> (Regression T1)`, async () => {
    const body = await outboundBody({ provider, behavior: "endCall" });
    // Dokumentierter heutiger Bug: ruft der Agent im ersten Turn end_call, endet
    // der Body mit <Hangup/> OHNE <Gather> -> Provider legt nach dem Satz auf, STT
    // wird nie scharf. Aendert ein Fix dieses Verhalten, MUSS dieser Test angepasst
    // werden (er pinnt absichtlich das Ist-Verhalten als Regression).
    assert.ok(!body.includes(GATHER), `endCall-Pfad pinnt den Bug: erwartet KEIN <Gather>, Body: ${body}`);
    assert.ok(body.includes(FAREWELL), `Abschiedssatz fehlt vor dem Hangup: ${body}`);
    assertDisclosureBefore(body, HANGUP);
  });

  test(`/voice/outbound (${provider}): agentTurn wirft -> Offenlegung + Hangup ohne <Gather> (T2)`, async () => {
    const body = await outboundBody({ provider, behavior: "throw" });
    assert.ok(!body.includes(GATHER), `Fehlerpfad darf kein <Gather> rendern: ${body}`);
    assertDisclosureBefore(body, HANGUP);
    // Diskriminator T1 vs T2: im Fehlerpfad faellt der Anliegen-/Abschiedssatz weg,
    // gesprochen wird NUR die Offenlegung (vgl. call-debug.md Abschnitt 3.4).
    assert.ok(!body.includes(AGENT_SPEECH) && !body.includes(FAREWELL), `Fehlerpfad spricht nur die Offenlegung: ${body}`);
  });
}
