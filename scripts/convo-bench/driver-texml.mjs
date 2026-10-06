import { parseVoiceBody } from "./texml.mjs";
import { TELNYX_DUMMY_HEADERS } from "./bench-constants.mjs";
import { BENCH_DEFAULT_CALLER } from "./bench-constants.mjs";

export const TEXML_DRIVER_ID = "texml";

const CALL_SID = "CAtest_bench";

function extractCallIdFromUrl(url) {
  return new URL(url).searchParams.get("callId");
}

function toTurn(parsed) {
  const endedVia = parsed.hasHangup ? "agent_hangup" : !parsed.nextTurnUrl ? "no_gather" : null;
  return { sayTexts: parsed.sayTexts, endedVia };
}

export async function createTexmlTransport({ provider }) {
  let nextTurnUrl = null;
  let localUrl = null;

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
