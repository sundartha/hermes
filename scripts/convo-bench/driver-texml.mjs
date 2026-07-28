// AL-P8: der Bestands-Treiber der Conversation-Bench - TeXML/TwiML ueber
// /voice/outbound|incoming|turn|status. Verhalten byte-identisch zur Fassung, die vor
// dieser Phase in runner.mjs lebte (reine Verschiebung hinter den Treiber-Port,
// drivers.mjs); nur der Ort und die Rueckgabeform (turn statt parsed) haben sich
// geaendert (Muster scripts/convo-bench/drivers.mjs, Port-Vertrag im Kopfkommentar).
import { parseVoiceBody } from "./texml.mjs";
import { TELNYX_DUMMY_HEADERS } from "./telnyx-fake.mjs";

export const TEXML_DRIVER_ID = "texml";

const CALL_SID = "CAtest_bench";
const BENCH_DEFAULT_CALLER = "+4915100000099";

function extractCallIdFromUrl(url) {
  return new URL(url).searchParams.get("callId");
}

// turn.endedVia ersetzt das TeXML-spezifische hasHangup/!nextTurnUrl verhaltensgleich:
// hasHangup -> "agent_hangup", !nextTurnUrl -> "no_gather". turn_cap bleibt Sache des
// Runners (transportunabhaengiger globaler Kosten-Cap).
function toTurn(parsed) {
  const endedVia = parsed.hasHangup ? "agent_hangup" : !parsed.nextTurnUrl ? "no_gather" : null;
  return { sayTexts: parsed.sayTexts, endedVia };
}

// Der Bestands-Treiber: TeXML/TwiML ueber /voice/outbound|incoming|turn|status.
// scenario ist Teil des Treiber-Port-Vertrags (drivers.mjs); dieser Treiber braucht
// ausser provider nichts daraus (die scenario-abhaengigen Env-Felder setzt buildEnv
// im Runner, unabhaengig vom Treiber).
export async function createTexmlTransport({ provider }) {
  let nextTurnUrl = null;
  let localUrl = null;

  // Erster Request der Choreografie (Spec §3-2): outbound -> /voice/outbound, inbound
  // -> /voice/incoming (To=aktive Owner-Nummer, From=Anrufer). Fuer Telnyx werden die
  // Dummy-Signatur-Header gesetzt, damit providerFromHeaders() korrekt telnyx erkennt
  // (SKIP_TWILIO_SIGNATURE_CHECK umgeht nur die Krypto-Pruefung selbst).
  async function open({ srv, scenario: sc, call, activeOwnerNumber }) {
    localUrl = srv.localUrl;
    const isInbound = sc.direction === "inbound";
    const res = isInbound
      ? await fetch(`${srv.localUrl}/voice/incoming`, {
          method: "POST",
          headers: provider === "telnyx" ? TELNYX_DUMMY_HEADERS : {},
          body: new URLSearchParams({
            To: activeOwnerNumber.e164,
            From: sc.callerNumber || BENCH_DEFAULT_CALLER,
            CallSid: CALL_SID,
          }),
        })
      : await fetch(`${srv.localUrl}/voice/outbound?callId=${call.id}`, {
          method: "POST",
          body: new URLSearchParams({ CallSid: CALL_SID }),
        });
    const body = await res.text();
    const parsed = parseVoiceBody(body, srv.localUrl);
    nextTurnUrl = parsed.nextTurnUrl;
    if (isInbound) {
      if (!nextTurnUrl) throw new Error("Inbound-Erst-Turn lieferte kein Gather (unbekannte Nummer?)");
      return { callId: extractCallIdFromUrl(nextTurnUrl), turn: toTurn(parsed) };
    }
    return { callId: call.id, turn: toTurn(parsed) };
  }

  async function say(text) {
    if (!nextTurnUrl) throw new Error("driver-texml: say() ohne offenen Gather (nextTurnUrl fehlt)");
    const res = await fetch(nextTurnUrl, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: text }),
    });
    const parsed = parseVoiceBody(await res.text(), nextTurnUrl);
    nextTurnUrl = parsed.nextTurnUrl;
    return toTurn(parsed);
  }

  // Beendet den Call ueber die echte /voice/status-Webhook-Route (reiner Status-
  // Renderer, KEIN originateCall - Spec §6). Das Summary-Polling bleibt beim Runner
  // (transportunabhaengig).
  async function finish(callId) {
    await fetch(`${localUrl}/voice/status?callId=${callId}`, {
      method: "POST",
      body: new URLSearchParams({ CallStatus: "completed" }),
    }).catch(() => {});
  }

  return {
    env: {},
    seedOverrides: {},
    open,
    say,
    finish,
    close: async () => {},
    diagnostics: () => ({}),
  };
}
