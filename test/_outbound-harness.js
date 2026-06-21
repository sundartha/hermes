// G0: Gebuendelte Offline-Bank fuer den Outbound-/Turn-Pfad (Budget-Engine, beide
// Provider). Bislang in outbound-premature-close / outbound-greeting / disclosure-
// outbound dreifach kopiert (G5/S2) -> EINE Quelle. Baut auf test/helpers.js auf
// (startServer/seedState/seedCall), dupliziert KEINE Spawn-Logik. Reines Test-Land,
// KEIN src/-Import von Produktionslogik (nur indirekt ueber den gespawnten Server).
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState, seedCall } from "./helpers.js";

// --- Gemeinsame Marker (bisher pro Datei dupliziert) ---
// Praefix des fest verdrahteten Offenlegungssatzes (disclosureSentence, claude.js):
// gilt fuer callerName=null + OWNER_NAME="Jonas" (BASE_ENV). G1 dreht diese Erwartung
// bewusst um (eigener Test), der Marker bleibt hier der dokumentierte Ist-Stand.
export const DISCLOSURE_JONAS = "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas.";
// Beide Renderer oeffnen den Sprach-Turn mit "<Gather" (Twilio-TwiML + Telnyx-TeXML).
export const GATHER_OPEN = "<Gather";
export const HANGUP_TAG = "<Hangup";

// Default-Call-Id der Harness-Fixtures (selbsterklaerende Test-Fixture, kein Magic).
const DEFAULT_CALL_ID = "call_harness1";
// Provider-Webhooks erwarten eine CallSid im Body (Test-Fixture, wie im Bestand).
const CALL_SID = "CAtest";

// Disclosure muss als erster gesprochener Satz VOR dem Folge-Knoten stehen (Regel 2).
// Eine Quelle statt der byte-identischen Kopien in zwei Testdateien.
export function assertDisclosureBefore(body, marker, disclosure = DISCLOSURE_JONAS) {
  const discIdx = body.indexOf(disclosure);
  const markerIdx = body.indexOf(marker);
  assert.ok(discIdx !== -1, `Offenlegung fehlt im Body: ${body}`);
  assert.ok(markerIdx !== -1, `Marker '${marker}' fehlt im Body: ${body}`);
  assert.ok(discIdx < markerIdx, `Offenlegung muss VOR '${marker}' stehen: ${body}`);
}

// Faehrt /voice/outbound (LLM-frei) lokal und liefert den gerenderten Provider-Body
// (TwiML/TeXML) samt Status/Content-Type/stdout. Der Server wird intern geschlossen
// (kein srv-Handle nach aussen -> keine vom Aufrufer zu wahrende Stop-Reihenfolge,
// G31). call-Overrides ergaenzen den seedCall; seed-Overrides ergaenzen den Store.
export async function runOutbound({ provider = "twilio", call = {}, seed = {}, env = {} } = {}) {
  const id = call.id || DEFAULT_CALL_ID;
  const srv = await startServer({
    env,
    seed: seedState({
      calls: [seedCall({ id, provider, status: "active", direction: "outbound", ...call })],
      ...seed,
    }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/voice/outbound?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: CALL_SID }),
    });
    const body = await res.text();
    return { body, status: res.status, contentType: res.headers.get("content-type"), stdout: srv.stdout };
  } finally {
    await srv.stop();
  }
}

// Zwei-Schritt-Kette: /voice/outbound (LLM-frei) -> /voice/turn (LLM-getrieben).
// mockUrl lenkt den Anthropic-Client per ANTHROPIC_BASE_URL auf einen lokalen Mock;
// env-Override (z.B. LLM_MAX_RETRIES) wird durchgereicht. Server wird intern
// geschlossen (kein srv-Handle nach aussen, G31). Liefert beide Bodies, den
// Turn-Status und stdout.
export async function runOutboundThenTurn({ provider = "twilio", call = {}, speechResult, mockUrl, env = {} } = {}) {
  const id = call.id || DEFAULT_CALL_ID;
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mockUrl, ...env },
    seed: seedState({
      calls: [seedCall({ id, provider, status: "active", direction: "outbound", ...call })],
    }),
  });
  try {
    const outRes = await fetch(`${srv.localUrl}/voice/outbound?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: CALL_SID }),
    });
    assert.equal(outRes.status, 200);
    const outboundBody = await outRes.text();

    const turnRes = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: speechResult }),
    });
    const turnBody = await turnRes.text();
    return { outboundBody, turnBody, turnStatus: turnRes.status, stdout: srv.stdout };
  } finally {
    await srv.stop();
  }
}

// --- Anthropic-Mock-Fabriken (offline, deterministisch) ---
// Single-Consumer-Doubles fuer agentTurn: gelebte Wiederbenutzung des Outbound-/
// Turn-Pfads. agentTurn liest nur content + usage (usage PFLICHT, sonst trackUsage).

// Agent-Anliegen, das ein Mock nach erfolgreichem (Retry-)Call liefert.
export const AGENT_SPEECH = "Ich rufe im Auftrag von Jonas an und haette eine kurze Frage.";

// Minimale, aber vollstaendige Anthropic-Message.
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
export async function startCountingAnthropicMock({ failFirst }) {
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
export async function startAlwaysPrematureMock() {
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
export async function startAlways4xxMock() {
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
