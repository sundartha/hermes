// G0: Gebuendelte Offline-Bank fuer den Outbound-/Turn-Pfad (Budget-Engine, beide
// Provider). Bislang in outbound-premature-close / outbound-greeting / disclosure-
// outbound dreifach kopiert (G5/S2) -> EINE Quelle. Baut auf test/helpers.js auf
// (startServer/seedState/seedCall), dupliziert KEINE Spawn-Logik. Reines Test-Land,
// KEIN src/-Import von Produktionslogik (nur indirekt ueber den gespawnten Server).
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState, seedCall } from "./helpers.js";

// --- Gemeinsame Marker (bisher pro Datei dupliziert) ---
// Praefix des fest verdrahteten Offenlegungssatzes (disclosureSentence, claude.js).
// G1: die Offenlegung ist an den VOLLEN tenant.ownerName gebunden. P2b: die Owner-
// Identitaet lebt im Store (kein config-Seed mehr) - ensureOwnerNumber seedet den
// Owner-Tenant mit ownerName "Jonas Beispiel" (OWNER_TEST_FIRST_NAME/-LAST_NAME in
// helpers.js). callerName entfaellt komplett (nicht mehr per Call setzbar).
export const DISCLOSURE_JONAS =
  "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas Beispiel.";
// Der Renderer oeffnet den Sprach-Turn mit "<Gather" (Telnyx-TeXML).
export const GATHER_OPEN = "<Gather";
export const HANGUP_TAG = "<Hangup";

// G2: Die Offenlegung wird als Say INNERHALB des Gather gerendert (Erst-Turn nennt
// Offenlegung + Anliegen, Mikrofon sofort offen). Das Gather oeffnet also VOR der
// Offenlegung (gatherIdx < discIdx). Eine Quelle statt der byte-identischen Kopien in
// drei Testdateien (G5/S2). Marker GATHER_OPEN ist providerneutral ("<Gather" ist TwiML
// und TeXML gemeinsam).
export function assertDisclosureInGather(body, disclosure = DISCLOSURE_JONAS) {
  const gatherIdx = body.indexOf(GATHER_OPEN);
  const discIdx = body.indexOf(disclosure);
  assert.ok(gatherIdx !== -1, `Gather fehlt im Body: ${body}`);
  assert.ok(discIdx !== -1, `Offenlegung fehlt im Body: ${body}`);
  assert.ok(
    gatherIdx < discIdx,
    `Offenlegung muss IM Gather stehen (Gather oeffnet zuerst): ${body}`,
  );
}

// Default-Call-Id der Harness-Fixtures (selbsterklaerende Test-Fixture, kein Magic).
const DEFAULT_CALL_ID = "call_harness1";
// Provider-Webhooks erwarten eine CallSid im Body (Test-Fixture, wie im Bestand).
const CALL_SID = "CAtest";

// Server + Seed fuer einen /voice/outbound-Testaufruf starten (G5: EINE Spawn-Quelle
// fuer runOutbound UND runOutboundKeepOpen, statt der frueheren Kopie in
// voice-play-tts.test.js, S2). call-Overrides ergaenzen den seedCall; seed-Overrides
// ergaenzen den Store. Liefert das srv-Handle + die fuer den Fetch noetige id;
// Schliessen des Servers ist Sache der Aufrufer unten.
async function startOutboundServer({ provider = "telnyx", call = {}, seed = {}, env = {} } = {}) {
  const id = call.id || DEFAULT_CALL_ID;
  const srv = await startServer({
    env,
    seed: seedState({
      calls: [seedCall({ id, provider, status: "active", direction: "outbound", ...call })],
      ...seed,
    }),
  });
  return { srv, id };
}

// Faehrt /voice/outbound auf einem bereits gestarteten Server und liefert den
// gerenderten Provider-Body (TwiML/TeXML) samt Status/Content-Type.
async function fetchOutbound(srv, id) {
  const res = await fetch(`${srv.localUrl}/voice/outbound?callId=${id}`, {
    method: "POST",
    body: new URLSearchParams({ CallSid: CALL_SID }),
  });
  const body = await res.text();
  return { body, status: res.status, contentType: res.headers.get("content-type") };
}

// Faehrt /voice/outbound (LLM-frei) lokal und liefert den gerenderten Provider-Body
// (TwiML/TeXML) samt Status/Content-Type/stdout. Der Server wird intern geschlossen
// (kein srv-Handle nach aussen -> keine vom Aufrufer zu wahrende Stop-Reihenfolge,
// G31). call-Overrides ergaenzen den seedCall; seed-Overrides ergaenzen den Store.
export async function runOutbound(opts = {}) {
  const { srv, id } = await startOutboundServer(opts);
  try {
    const result = await fetchOutbound(srv, id);
    return { ...result, stdout: srv.stdout };
  } finally {
    await srv.stop();
  }
}

// Wie runOutbound, laesst das srv-Handle aber OFFEN (kein Boolean-Selektor-Arg,
// eigener Name statt Flag, G15/F3 - Konvention aus followupTurnDirectives). Fuer
// Tests, die NACH dem Turn noch etwas am laufenden Server pruefen muessen (z.B. den
// ElevenLabs-Token-Abruf ueber /voice/tts/:token, voice-play-tts.test.js). Das
// Schliessen (srv.stop()) liegt beim Aufrufer.
export async function runOutboundKeepOpen(opts = {}) {
  const { srv, id } = await startOutboundServer(opts);
  const result = await fetchOutbound(srv, id);
  return { ...result, srv };
}

// Zwei-Schritt-Kette: /voice/outbound (LLM-frei) -> /voice/turn (LLM-getrieben).
// mockUrl lenkt den Anthropic-Client per ANTHROPIC_BASE_URL auf einen lokalen Mock;
// env-Override (z.B. LLM_MAX_RETRIES) wird durchgereicht. Server wird intern
// geschlossen (kein srv-Handle nach aussen, G31). Liefert beide Bodies, den
// Turn-Status und stdout.
export async function runOutboundThenTurn({
  provider = "telnyx",
  call = {},
  speechResult,
  mockUrl,
  env = {},
} = {}) {
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
      res.end(
        JSON.stringify({
          type: "error",
          error: { type: "invalid_request_error", message: "mock-fehler" },
        }),
      );
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    count: () => seen,
    close: () => new Promise((r) => server.close(r)),
  };
}
