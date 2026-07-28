// AL-P8: der LIVE laufende Pfad (O1) als Bench-Treiber - Opening ueber Call-Control-
// speak, Gespraechsturns ueber den in-house /v1/chat/completions-Shim.
//
// KEIN BYPASS: der gespawnte Server zieht die vollen assertConfig-Pflichtfelder und
// ALLE VIER Shim-Gates (Existenz-Flag, Bearer via safeEqual, ccid-Korrelation auf einen
// aktiven Call, Rate/Budget). Sie werden mit WEGWERF-Werten aus
// test/helpers.js#TELNYX_ASSISTANT_BOOT_ENV erfuellt (nie Prod-Secrets) und einem
// geseedeten aktiven Call mit passender callControlId - nicht mit einem Schalter.
import { TELNYX_ASSISTANT_BOOT_ENV } from "../../test/helpers.js";
import { startTelnyxFake, TELNYX_DUMMY_HEADERS, callControlEventBody } from "./telnyx-fake.mjs";
import { BENCH_DEFAULT_CALLER as SHIM_DEFAULT_CALLER } from "./bench-constants.mjs";

export const SHIM_DRIVER_ID = "shim";

const BENCH_CALL_CONTROL_ID = "cc_bench";
// Nachlauf nach einer 200er Shim-Antwort: der Abschieds-Log (farewell_scheduled) ist
// unconditional, aber async zur HTTP-Antwort - ein kurzer, fruehzeitig abbrechender
// Poll-Takt reicht (Muster ACTION_POLL_INTERVAL_MS in telnyx-fake.mjs).
const FAREWELL_LOG_GRACE_MS = 250;
const LOG_POLL_INTERVAL_MS = 10;
// Der Modellname, den Telnyx im BYO-LLM-Body sendet; der Shim ignoriert ihn zugunsten
// von config.llm.claudeModel (nur Log-Kosmetik hier).
const SHIM_MODEL = "gpt-4o-mini";
// AL-P8 (dokumentierte Transport-Abweichung): ein stiller Callee-Turn geht hier als
// LEERE user-Message raus. Live entsteht bei Stille gar kein Shim-Request - es liefe
// der Dead-Air-Watchdog. Das ist die naechstliegende Naeherung; hold-warteschleife
// misst deshalb ausdruecklich nur auf dem TeXML-Treiber (scenario.drivers).
const SILENT_TURN_SHIM_TEXT = "";

const SHIM_ROUTE = "/v1/chat/completions";
const HTTP_FORBIDDEN = 403;

// Der EINE Ort, an dem ein Shim-Turn-Request gebaut wird (G5) - vom Treiber UND vom
// 403-Beweis (test/al-p8-bench-shim-gates.test.js) benutzt. secret ist ein Argument,
// kein Modul-Zugriff: nur so kann der Test mit einem FALSCHEN Secret exakt denselben
// Request bauen.
export function shimTurnRequest({ baseUrl, secret, callControlId, text, model }) {
  return {
    url: `${baseUrl}${SHIM_ROUTE}`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [{ role: "user", content: text }],
        extra_metadata: { call_control_id: callControlId },
      }),
    },
  };
}

const SSE_DATA_PREFIX = "data:";
const SSE_DONE_MARKER = "[DONE]";

// Gesprochener Text aus einer Shim-Antwort. stream:true -> SSE-delta.content
// konkateniert (Chunk-Layout-agnostisch, Muster test/telnyx-shim-harness.js
// #sseContent); stream:false -> choices[0].message.content.
export function completionSpeech(bodyText, contentType) {
  if (typeof contentType === "string" && contentType.includes("text/event-stream")) {
    let out = "";
    for (const line of bodyText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith(SSE_DATA_PREFIX)) continue;
      const payload = trimmed.slice(SSE_DATA_PREFIX.length).trim();
      if (payload === SSE_DONE_MARKER) continue;
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue; // unvollstaendige/fremde SSE-Zeile ignorieren, kein Absturz
      }
      const content = parsed?.choices?.[0]?.delta?.content;
      if (typeof content === "string") out += content;
    }
    return out;
  }
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return "";
  }
  return parsed?.choices?.[0]?.message?.content ?? "";
}

const FAREWELL_LOG_MARKER = "[telnyx-shim] farewell_scheduled";

// Hat der Shim fuer DIESEN Call den Abschieds-Hangup geplant? Zeilenweise Suche nach
// farewell_scheduled UND "callId":"<id>" in derselben Zeile - schluesselreihenfolge-
// unabhaengig. Das ist das Shim-Aequivalent zu <Hangup> im TeXML-Body.
export function farewellScheduled(stdout, callId) {
  const needle = `"callId":"${callId}"`;
  return stdout.split("\n").some((line) => line.includes(FAREWELL_LOG_MARKER) && line.includes(needle));
}

const GATE_LOG_RE = /^\[telnyx-shim\] gate (\{.*\})$/;

// PII-freie Gate-Gruende dieses Calls aus dem Server-stdout ([telnyx-shim] gate).
// Macht sichtbar, WANN ein Safety-Gate den Bench-Turn abgeschnitten hat. Nur die
// reason-Token (nie Transkript/Secret) - dieselbe Allowlist-Disziplin wie logShimGate.
export function shimGateReasons(stdout, callId) {
  const reasons = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(GATE_LOG_RE);
    if (!m) continue;
    let payload;
    try {
      payload = JSON.parse(m[1]);
    } catch {
      continue;
    }
    if (payload.callId === callId) reasons.push(payload.reason);
  }
  return reasons;
}

// Wartet bounded auf den farewell_scheduled-Log dieses Calls (der Log ist async zur
// HTTP-Antwort). Kein Treffer binnen der Gnadenfrist -> kein Agent-Hangup diesen Turn.
async function waitForFarewell(getStdout, callId) {
  const deadline = Date.now() + FAREWELL_LOG_GRACE_MS;
  for (;;) {
    if (farewellScheduled(getStdout(), callId)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, LOG_POLL_INTERVAL_MS));
  }
}

// Der LIVE laufende Pfad (O1): Opening ueber Call-Control-speak, Gespraechsturns ueber
// den in-house /v1/chat/completions-Shim.
export async function createShimTransport() {
  const fake = await startTelnyxFake();
  let localUrl = null;
  let getStdout = () => "";
  let callId = null;

  async function open({ srv, scenario, call, activeOwnerNumber }) {
    localUrl = srv.localUrl;
    getStdout = () => srv.stdout;
    const isInbound = scenario.direction === "inbound";

    if (!isInbound) {
      callId = call.id;
      await postCallControlEvent(localUrl, callId, { eventType: "call.answered", callControlId: BENCH_CALL_CONTROL_ID });
      const speakAction = await fake.waitForAction({ callControlId: BENCH_CALL_CONTROL_ID, action: "speak" });
      const opening = speakAction.body.payload;
      await postCallControlEvent(localUrl, callId, {
        eventType: "call.speak.ended",
        callControlId: BENCH_CALL_CONTROL_ID,
        status: "completed",
      });
      await fake.waitForAction({ callControlId: BENCH_CALL_CONTROL_ID, action: "ai_assistant_start" });
      return { callId, turn: { sayTexts: [opening], endedVia: null } };
    }

    const res = await fetch(`${localUrl}/voice/incoming`, {
      method: "POST",
      headers: TELNYX_DUMMY_HEADERS,
      body: new URLSearchParams({
        To: activeOwnerNumber.e164,
        From: scenario.callerNumber || SHIM_DEFAULT_CALLER,
        CallControlId: BENCH_CALL_CONTROL_ID,
      }),
    });
    await res.text(); // Handoff-TeXML (leere Direktivenliste), fuer den Shim-Treiber uninteressant
    const speakAction = await fake.waitForAction({ callControlId: BENCH_CALL_CONTROL_ID, action: "speak" });
    const greeting = speakAction.body.payload;
    const seededCall = (srv.readStore().calls || []).find((c) => c.callControlId === BENCH_CALL_CONTROL_ID);
    if (!seededCall) throw new Error("driver-shim: Inbound-Call mit callControlId nicht im Store gefunden");
    callId = seededCall.id;
    return { callId, turn: { sayTexts: [greeting], endedVia: null } };
  }

  async function say(text = SILENT_TURN_SHIM_TEXT) {
    const secret = TELNYX_ASSISTANT_BOOT_ENV.TELNYX_SHIM_SHARED_SECRET;
    const req = shimTurnRequest({ baseUrl: localUrl, secret, callControlId: BENCH_CALL_CONTROL_ID, text, model: SHIM_MODEL });
    const res = await fetch(req.url, req.init);
    const bodyText = await res.text();
    if (res.status === HTTP_FORBIDDEN) return { sayTexts: [], endedVia: "shim_denied" };
    if (!res.ok) return { sayTexts: [], endedVia: "shim_error" };
    const speech = completionSpeech(bodyText, res.headers.get("content-type"));
    const farewell = await waitForFarewell(getStdout, callId);
    return { sayTexts: [speech], endedVia: farewell ? "agent_hangup" : null };
  }

  async function finish(finishCallId) {
    await postCallControlEvent(localUrl, finishCallId, {
      eventType: "call.hangup",
      callControlId: BENCH_CALL_CONTROL_ID,
    }).catch(() => {});
  }

  return {
    env: { TELNYX_AI_ASSISTANT_ENABLED: "true", ...TELNYX_ASSISTANT_BOOT_ENV, TELNYX_API_BASE: fake.url },
    seedOverrides: { callControlId: BENCH_CALL_CONTROL_ID, assistantId: TELNYX_ASSISTANT_BOOT_ENV.TELNYX_ASSISTANT_ID },
    open,
    say,
    finish,
    close: () => fake.close(),
    diagnostics: () => ({ shim_gate_reasons: callId ? shimGateReasons(getStdout(), callId) : [] }),
  };
}

// EIN Call-Control-Event an /voice/call-control posten (G5: alle drei Events - answered/
// speak.ended/hangup - teilen dieselbe Form).
async function postCallControlEvent(localUrl, callId, { eventType, callControlId, status }) {
  return fetch(`${localUrl}/voice/call-control?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(callControlEventBody({ eventType, callControlId, status })),
  });
}
