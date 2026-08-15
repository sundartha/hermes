// Owner-Auftrag 15.08.2026: der EL-Weg (ElevenLabs-Convai-SIP-Anrufstart) haelt am Call nur
// elevenlabsConversationId - hangUpAction() (telephony/call-termination.js) verzweigt ueber
// callControlId/providerCallSid und liefert dafuer fail-safe null: BELEGT war, dass heute
// WEDER der Max-Dauer-Cap NOCH cancel_call fuer einen EL-Call ueberhaupt einen Beende-
// Versuch ausloesen - die Leitung laeuft weiter und kostet weiter. Vier Ebenen, offline
// (Attrappe fuer den Anbieter, kein Netz, kein echter Server, P12 F.I.R.S.T.):
//   A) convai.js#endConversation - FAIL-SOFT (wirft nie)
//   B) outbound.js#endActiveCall - REIHENFOLGE (Ergebnisabruf VOR Loeschversuch), fail-soft
//   C) call-termination.js#elevenLabsHangUpAction + die Verdrahtung in call-lifecycle.js
//      (Max-Dauer-Cap) und routes/api-calls.js (cancel_call) loesen den Versuch tatsaechlich
//      aus UND terminalisieren den eigenen Datensatz auch bei totalem Anbieter-Ausfall
//   D) cancel_call luegt nicht: die Antwort behauptet keinen Leitungs-Abbruch und nennt N
//
// S1-Nachbesserung 15.08.2026 (unabhaengige Durchsicht der Phase-1-Commits): fuenf weitere
// Ebenen unten im Anschluss an D:
//   S1-3) der Ergebnisabruf im ABBRUCH-Pfad (endActiveCall) nutzt eine EIGENE, kurze Frist
//         statt der 120s des Anrufstarts - ein stummer Anbieter darf Kappung/cancel_call
//         nicht zwei Minuten haengen lassen
//   S1-4) die ehrliche Antwortform gilt fuer JEDEN EL-Anruf (Call-FORM), auch OHNE bereits
//         angekommene Kennung (Klingelphase) - plus: hangUpAction() nur EINMAL ausgewertet
//   S1-5) der Vorgabewert fuer elevenLabsHangUpAction wird LAUT statt still, wenn er
//         tatsaechlich fuer einen EL-Call gebraucht wird
//   S2)   answeredAnchorOutcome wirft nicht mehr, wenn endedAtIso fehlt/unbrauchbar ist
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { endConversation, REQUEST_TIMEOUT_MS } from "../src/elevenlabs/convai.js";
import {
  makeElevenLabsOutbound,
  answeredAnchorOutcome,
  ELEVENLABS_PROVIDER_MAX_DURATION_S,
  EL_ABORT_RESULT_FETCH_TIMEOUT_MS,
} from "../src/elevenlabs/outbound.js";
import {
  elevenLabsHangUpAction,
  hangUpAction,
  terminateAndBillCall,
  billThunk,
} from "../src/telephony/call-termination.js";
import { makeCallLifecycle } from "../src/telephony/call-lifecycle.js";
import { makeCallRoutes } from "../src/routes/api-calls.js";
import { cappedEndedAtMs, classifyCallTime } from "../src/store/state-ops.js";
import { VOICE_ENGINE } from "../src/config.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const ACCOUNT = { apiKey: "test-key", apiBase: "https://el.test" };
const CONV_ID = "conv_1";
const HTTP_OK = 200;
const HTTP_UNPROCESSABLE = 422;
const HTTP_SERVER_ERROR = 500;
const ONE_HOUR_MS = 3600000;
const elConfig = () => withConfigNamespaces({ elevenLabsOutbound: ACCOUNT });

async function withFetch(fetchImpl, run) {
  const orig = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = orig;
  }
}

// ---- A: convai.js#endConversation (FAIL-SOFT) ------------------------------------------

test("endConversation: Anbieter nimmt den Loeschversuch an (200) -> accepted true", async () => {
  const result = await endConversation({
    fetchImpl: async () => ({ ok: true, status: HTTP_OK }),
    account: ACCOUNT,
    conversationId: CONV_ID,
  });
  assert.deepEqual(result, { accepted: true, status: HTTP_OK });
});

test("endConversation: Anbieter lehnt ab (422) -> wirft NICHT, meldet nur accepted:false", async () => {
  const result = await endConversation({
    fetchImpl: async () => ({ ok: false, status: HTTP_UNPROCESSABLE }),
    account: ACCOUNT,
    conversationId: CONV_ID,
  });
  assert.deepEqual(result, { accepted: false, status: HTTP_UNPROCESSABLE });
});

test("endConversation: Netzfehler/Timeout -> wirft NICHT (fail-soft), status null", async () => {
  const result = await endConversation({
    fetchImpl: async () => {
      throw new Error("ECONNRESET");
    },
    account: ACCOUNT,
    conversationId: CONV_ID,
  });
  assert.deepEqual(result, { accepted: false, status: null });
});

// ---- B: outbound.js#endActiveCall (Reihenfolge + fail-soft) ----------------------------

function spyStore(call) {
  const order = [];
  return {
    order,
    getCall: () => call,
    addTranscript: () => order.push("addTranscript"),
    recordProviderCallResult: () => order.push("recordProviderCallResult"),
    trueUpAnsweredAt: () => order.push("trueUpAnsweredAt"),
    recordAnsweredUnclearReason: () => order.push("recordAnsweredUnclearReason"),
  };
}

function makeOutbound(store) {
  return makeElevenLabsOutbound({
    store,
    config: elConfig(),
    terminateAndBillCall,
    billThunk: () => () => {},
    finishCall: () => {},
  });
}

test("endActiveCall: Ergebnisabruf (GET) wird ZUERST geholt und persistiert, ERST DANACH geloescht (DELETE)", async () => {
  const call = { id: "call_1", elevenlabsConversationId: CONV_ID, endedAt: "2026-08-15T10:00:00.000Z" };
  const store = spyStore(call);
  const el = makeOutbound(store);
  const methods = [];
  await withFetch(async (_url, init) => {
    methods.push(init.method);
    if (init.method === "GET")
      return {
        ok: true,
        status: HTTP_OK,
        json: async () => ({
          status: "done",
          transcript: [{ role: "agent", message: "Hallo" }],
          metadata: { call_duration_secs: 30 },
          analysis: {},
        }),
      };
    return { ok: true, status: HTTP_OK };
  }, () => el.endActiveCall(call.id));
  assert.deepEqual(methods, ["GET", "DELETE"], "Reihenfolge: Ergebnisabruf VOR dem Loeschversuch");
  assert.deepEqual(
    store.order,
    ["addTranscript", "recordProviderCallResult", "trueUpAnsweredAt"],
    "Transkript und Buchungsanker sind PERSISTIERT, bevor der Loeschversuch laeuft",
  );
});

test("endActiveCall: Ergebnisabruf scheitert -> Persistenz entfaellt, der Loeschversuch laeuft TROTZDEM", async () => {
  const call = { id: "call_2", elevenlabsConversationId: CONV_ID, endedAt: null };
  const store = spyStore(call);
  const el = makeOutbound(store);
  const methods = [];
  await withFetch(async (_url, init) => {
    methods.push(init.method);
    if (init.method === "GET") throw new Error("provider timeout");
    return { ok: false, status: HTTP_SERVER_ERROR };
  }, () => el.endActiveCall(call.id));
  assert.deepEqual(methods, ["GET", "DELETE"], "der Loeschversuch bleibt NICHT aus, nur weil der Abruf scheiterte");
  assert.deepEqual(store.order, [], "ohne Ergebnis gibt es nichts zu persistieren");
});

test("endActiveCall: ohne elevenlabsConversationId -> No-op (kein Netzzugriff)", async () => {
  const store = spyStore({ id: "call_3", elevenlabsConversationId: null });
  const el = makeOutbound(store);
  await withFetch(async () => {
    throw new Error("darf nicht aufgerufen werden");
  }, () => el.endActiveCall("call_3"));
});

// ---- S1-3: der Ergebnisabruf im ABBRUCH-Pfad nutzt eine EIGENE, kuerzere Frist ----------
// AbortSignal.timeout wird ABGEFANGEN statt real abgewartet (P12 Fast, kein 10s-Sleep im
// Test) - jeder Aufruf zeichnet seinen Millisekunden-Wert auf UND delegiert an die echte
// Implementierung (das zurueckgegebene Signal bleibt real nutzbar).
async function withAbortSignalTimeoutSpy(run) {
  const original = AbortSignal.timeout;
  const calls = [];
  AbortSignal.timeout = (ms) => {
    calls.push(ms);
    return original.call(AbortSignal, ms);
  };
  try {
    await run();
  } finally {
    AbortSignal.timeout = original;
  }
  return calls;
}

test("S1-3: EL_ABORT_RESULT_FETCH_TIMEOUT_MS ist deutlich kuerzer als das Bestands-Zeitlimit", () => {
  assert.ok(
    EL_ABORT_RESULT_FETCH_TIMEOUT_MS < REQUEST_TIMEOUT_MS,
    "die Abbruch-Pfad-Frist muss kuerzer sein als convai.js REQUEST_TIMEOUT_MS (120000ms)",
  );
});

test("S1-3: endActiveCall nutzt fuer den Ergebnisabruf EL_ABORT_RESULT_FETCH_TIMEOUT_MS statt der 120s-Bestandsfrist", async () => {
  const call = { id: "call_timeout", elevenlabsConversationId: CONV_ID, endedAt: "2026-08-15T10:00:00.000Z" };
  const store = spyStore(call);
  const el = makeOutbound(store);
  const timeoutCalls = await withAbortSignalTimeoutSpy(() =>
    withFetch(
      async (_url, init) => {
        if (init.method === "GET")
          return {
            ok: true,
            status: HTTP_OK,
            json: async () => ({
              status: "done",
              transcript: [],
              metadata: { call_duration_secs: 30 },
              analysis: {},
            }),
          };
        return { ok: true, status: HTTP_OK };
      },
      () => el.endActiveCall(call.id),
    ),
  );
  assert.deepEqual(
    timeoutCalls,
    [EL_ABORT_RESULT_FETCH_TIMEOUT_MS, REQUEST_TIMEOUT_MS],
    "GET (Ergebnisabruf) nutzt die kurze Abbruch-Frist, DELETE (Loeschversuch) bleibt beim Bestandswert",
  );
});

// ---- S1-1: der unklare Buchungsanker wird LAUT, nicht mehr still -----------------------
// Faellt metadata.call_duration_secs beim Anbieter weg/wird umbenannt, bucht dieser Zweig
// bewusst NICHTS (Owner-Auflage, unveraendert) - aber das darf nicht MEHR unbemerkt bleiben.

test("S1-1: fehlendes metadata.call_duration_secs loggt LAUT auf Fehlerebene (greifbarer Marker, callId, Grund, KEINE Rufnummer)", async () => {
  const call = { id: "call_unclear", elevenlabsConversationId: CONV_ID, endedAt: "2026-08-15T10:00:00.000Z" };
  const store = spyStore(call);
  const el = makeOutbound(store);
  const errorLines = [];
  const originalError = console.error;
  console.error = (...args) => errorLines.push(args.join(" "));
  try {
    await withFetch(
      async (_url, init) => {
        if (init.method === "GET")
          return {
            ok: true,
            status: HTTP_OK,
            // KEIN call_duration_secs - der stille Totalausfall aus S1-1.
            json: async () => ({ status: "done", transcript: [], metadata: {}, analysis: {} }),
          };
        return { ok: true, status: HTTP_OK };
      },
      () => el.endActiveCall(call.id),
    );
  } finally {
    console.error = originalError;
  }
  assert.ok(
    errorLines.some(
      (line) =>
        line.includes("Buchungsanker unklar") &&
        line.includes(call.id) &&
        line.includes("call_duration_secs_unusable"),
    ),
    "der unklare Fall bleibt NICHT still - Fehlerebene-Log mit callId und Grund",
  );
});

// ---- C: elevenLabsHangUpAction (pure Entscheidung) --------------------------------------

test("elevenLabsHangUpAction: EL-Call (elevenlabsConversationId gesetzt) -> Thunk ruft endActiveCall(call.id)", async () => {
  const seen = [];
  const thunk = elevenLabsHangUpAction(async (id) => seen.push(id), {
    id: "call_x",
    elevenlabsConversationId: CONV_ID,
  });
  assert.equal(typeof thunk, "function");
  await thunk();
  assert.deepEqual(seen, ["call_x"]);
});

test("elevenLabsHangUpAction: kein elevenlabsConversationId -> null (fail-safe, wie hangUpAction ohne Handle)", () => {
  assert.equal(elevenLabsHangUpAction(async () => {}, { id: "call_x" }), null);
});

// ---- C: Verdrahtung Max-Dauer-Cap (call-lifecycle.js) -----------------------------------

function elShapedCall(id) {
  return {
    id,
    status: "active",
    provider: "telnyx",
    elevenlabsConversationId: CONV_ID,
    // KEIN callControlId, KEIN twilioSid: hangUpAction() geht fail-safe leer aus
    // (Praezedenz T4, telnyx-p6-cap-callcontrol.test.js) - genau die EL-Call-FORM.
    startedAt: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
    maxDurationS: 60,
  };
}

test("Max-Dauer-Cap: ein EL-Call loest jetzt den EL-Beende-Versuch aus (vorher: nichts)", async () => {
  const call = elShapedCall("call_cap_el");
  const endCalls = [];
  const store = {
    load: () => ({ calls: [call] }),
    getCall: (id) => (id === call.id ? call : null),
    setCallEndedAt: (id, status, endedAtIso) => {
      call.status = status;
      call.endedAt = endedAtIso;
    },
    recordFailureReason: () => {},
  };
  let billed;
  const billedP = new Promise((resolve) => (billed = resolve));
  const lifecycle = makeCallLifecycle({
    store,
    config: withConfigNamespaces({ voiceEngine: VOICE_ENGINE.BUDGET }),
    finishCall: () => billed(),
    releaseReserve: () => {},
    voiceControl: () => ({ async endCall() {}, async endCallViaCallControl() {} }),
    terminateAndBillCall,
    hangUpAction,
    elevenLabsHangUpAction,
    endActiveCall: async (id) => endCalls.push(id),
    billThunk,
    reattachActiveCallCore: () => ({ call: null, logUnknown: false }),
    cappedEndedAtMs,
    classifyCallTime,
  });
  lifecycle.rearmActiveCallTimers(); // Zombie (Restzeit<=0) -> terminateCappedCall
  await billedP;
  assert.deepEqual(endCalls, [call.id], "der EL-Beende-Versuch lief genau einmal fuer den EL-Call");
});

// ---- C+D: Verdrahtung + Ehrlichkeit cancel_call (routes/api-calls.js) -------------------

// elevenLabsOutbound.enabled:true, weil S1-4 die EL-Form ueber GENAU diesen Schalter
// erkennt (config.voice.elevenLabsOutbound.enabled, s. routes/api-calls.js) - ohne ihn
// wuerfe jeder Test unten mit einem EL-geformten Call (kein callControlId/twilioSid) eine
// TypeError (config.voice.elevenLabsOutbound.enabled las sonst von undefined). Der
// Telnyx-Form-Test unten bleibt unberuehrt: providerHangUp ist dort truthy, der Schalter
// wird wegen Kurzschluss-Auswertung (&&) nie gelesen.
function baseRouteDeps(store, extra) {
  return {
    store,
    config: withConfigNamespaces({ multiTenant: false, elevenLabsOutbound: { enabled: true } }),
    audit: () => {},
    outboundGates: [],
    voiceControl: () => ({ async endCall() {}, async endCallViaCallControl() {} }),
    originateAiAssistantCall: async () => {},
    terminateAndBillCall,
    hangUpAction,
    billThunk,
    finishCall: () => {},
    arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
    tenant: { requestTenant: () => null, requireTenant: () => null, tenantOwnsCall: () => true },
    consultDelivery: { waitForEvent: async () => ({}) },
    internalIdentity: () => null,
    OWNER_ID: "owner",
    ...extra,
  };
}

async function postCancel(deps, callId) {
  const app = express();
  app.use(express.json());
  app.use(makeCallRoutes(deps));
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/calls/${callId}/cancel`, {
      method: "POST",
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("cancel_call: EL-Call loest den Beende-Versuch aus UND behauptet keinen Leitungs-Abbruch (nennt N)", async () => {
  const call = elShapedCall("call_cancel_el");
  const store = {
    getCall: (id) => (id === call.id ? call : null),
    endCallRecord: (id, status) => {
      call.status = status;
    },
  };
  const endCalls = [];
  const { status, body } = await postCancel(
    baseRouteDeps(store, { elevenLabsHangUpAction, endActiveCall: async (id) => endCalls.push(id) }),
    call.id,
  );
  assert.equal(status, HTTP_OK);
  assert.deepEqual(endCalls, [call.id], "der Beende-Versuch lief (heute: ueberhaupt nicht)");
  assert.equal(body.status, "cancelled", "Datensatz storniert");
  assert.equal(body.line_hangup_confirmed, false, "keine Behauptung, die Leitung sei bestaetigt unten");
  assert.equal(body.max_line_s, ELEVENLABS_PROVIDER_MAX_DURATION_S, "nennt die Obergrenze statt zu schweigen");
});

test("cancel_call: Telnyx-Call bleibt bei der reinen Kurzantwort (kein EL-Feld, kein EL-Versuch)", async () => {
  const call = { id: "call_cancel_tx", status: "active", provider: "telnyx", twilioSid: "CA_1" };
  const store = {
    getCall: (id) => (id === call.id ? call : null),
    endCallRecord: (id, status) => {
      call.status = status;
    },
  };
  const endCalls = [];
  const { body } = await postCancel(
    baseRouteDeps(store, { elevenLabsHangUpAction, endActiveCall: async (id) => endCalls.push(id) }),
    call.id,
  );
  assert.deepEqual(body, { status: "cancelled" }, "byte-identisch zum Telnyx-Bestand");
  assert.equal(endCalls.length, 0, "kein EL-Versuch fuer einen Telnyx-Call");
});

// ---- S1-4: die ehrliche Antwortform gilt fuer JEDEN EL-Anruf, auch OHNE Kennung ---------

test("S1-4: EL-Anruf OHNE Kennung (noch in der Klingelphase) bekommt trotzdem die ehrliche Antwortform", async () => {
  const call = { ...elShapedCall("call_cancel_el_ringing"), elevenlabsConversationId: null };
  const store = {
    getCall: (id) => (id === call.id ? call : null),
    endCallRecord: (id, status) => {
      call.status = status;
    },
  };
  const endCalls = [];
  const { status, body } = await postCancel(
    baseRouteDeps(store, { elevenLabsHangUpAction, endActiveCall: async (id) => endCalls.push(id) }),
    call.id,
  );
  assert.equal(status, HTTP_OK);
  assert.equal(endCalls.length, 0, "keine Kennung -> kein Griff auf das Gespraech, kein Versuch");
  assert.equal(body.status, "cancelled", "Datensatz storniert");
  assert.equal(body.line_hangup_confirmed, false);
  assert.equal(body.max_line_s, ELEVENLABS_PROVIDER_MAX_DURATION_S);
  assert.equal(
    body.hangup_attempted,
    false,
    "sagt AUSDRUECKLICH: kein Griff auf das Gespraech - nicht nur schweigen wie die alte Kurzantwort",
  );
});

test("S1-4: hangUpAction() wird GENAU EINMAL ausgewertet (vorher zweimal identisch aufgerufen)", async () => {
  const call = { id: "call_cancel_tx2", status: "active", provider: "telnyx", twilioSid: "CA_2" };
  const store = {
    getCall: (id) => (id === call.id ? call : null),
    endCallRecord: (id, status) => {
      call.status = status;
    },
  };
  let evaluations = 0;
  const spyHangUpAction = (...args) => {
    evaluations++;
    return hangUpAction(...args);
  };
  await postCancel(baseRouteDeps(store, { hangUpAction: spyHangUpAction }), call.id);
  assert.equal(evaluations, 1, "hangUpAction darf nur einmal ausgewertet werden, nicht zweimal identisch");
});

// ---- S1-5: der Vorgabewert fuer elevenLabsHangUpAction wird LAUT statt still ------------

test("S1-5: fehlt elevenLabsHangUpAction in der Verdrahtung, wird der Fallback LAUT (Fehlerebene-Log) UND die Antwort bleibt ehrlich", async () => {
  const call = elShapedCall("call_cancel_el_not_wired");
  const store = {
    getCall: (id) => (id === call.id ? call : null),
    endCallRecord: (id, status) => {
      call.status = status;
    },
  };
  const errorLines = [];
  const originalError = console.error;
  console.error = (...args) => errorLines.push(args.join(" "));
  try {
    // KEIN elevenLabsHangUpAction in extra -> makeCallRoutes' eigener Default greift.
    const { body } = await postCancel(baseRouteDeps(store), call.id);
    assert.equal(body.hangup_attempted, false, "kein Beende-Weg verdrahtet -> kein Versuch");
    assert.ok(
      errorLines.some((line) => line.includes("nicht verdrahtet")),
      "der Vorgabewert bleibt NICHT still - Fehlerebene-Log beim Gebrauch",
    );
  } finally {
    console.error = originalError;
  }
});

// ---- C: Fail-soft Ende-zu-Ende - totaler Anbieter-Ausfall storniert den Datensatz trotzdem

test("totaler Anbieter-Ausfall (GET und DELETE scheitern) -> Datensatz wird TROTZDEM storniert+gebucht", async () => {
  const call = { id: "call_failsoft", elevenlabsConversationId: CONV_ID, endedAt: null };
  const store = spyStore(call);
  const el = makeOutbound(store);
  const order = [];
  await withFetch(
    async () => {
      throw new Error("provider down");
    },
    () =>
      terminateAndBillCall({
        persistEnd: () => order.push("persistEnd"),
        hangUp: elevenLabsHangUpAction(el.endActiveCall, call),
        bill: () => order.push("bill"),
      }),
  );
  assert.deepEqual(order, ["persistEnd", "bill"], "Storno+Buchung laufen trotz totalem Anbieter-Ausfall");
});

// ---- S2: answeredAnchorOutcome darf nicht werfen, wenn endedAtIso fehlt/unbrauchbar ist -
// store.endCallRecord kann null liefern (Call zwischen Pruefung und Aufruf verschwunden) -
// finishFromConversation reicht dann ended?.endedAt === undefined durch. Date.parse(undefined)
// ist NaN; new Date(NaN).toISOString() WIRFT (RangeError: Invalid time value), mitten im
// Buchungspfad. Die Fail-Soft-Zusage des Moduls deckt bisher nur den Netzabruf, nicht diese
// reine Ableitung.

const CONVERSATION_WITH_POSITIVE_DURATION = { metadata: { call_duration_secs: 30 }, analysis: {} };

test("S2: answeredAnchorOutcome(undefined, ...) wirft NICHT, sondern faellt auf 'unklar' zurueck", () => {
  assert.doesNotThrow(() => answeredAnchorOutcome(undefined, CONVERSATION_WITH_POSITIVE_DURATION));
  const anchor = answeredAnchorOutcome(undefined, CONVERSATION_WITH_POSITIVE_DURATION);
  assert.equal(anchor.answeredAtIso, null, "ohne brauchbaren endedAtIso gibt es keinen Anker");
  assert.equal(anchor.unclearReason, "call_duration_secs_unusable");
});

test("S2: answeredAnchorOutcome('kaputt', ...) wirft NICHT bei einem nicht-parsebaren endedAtIso", () => {
  assert.doesNotThrow(() => answeredAnchorOutcome("kein-iso-datum", CONVERSATION_WITH_POSITIVE_DURATION));
  assert.equal(answeredAnchorOutcome("kein-iso-datum", CONVERSATION_WITH_POSITIVE_DURATION).answeredAtIso, null);
});

test("S2: gueltiger endedAtIso + positive Dauer liefert weiterhin den echten Anker (Regression)", () => {
  const anchor = answeredAnchorOutcome("2026-08-15T10:01:00.000Z", CONVERSATION_WITH_POSITIVE_DURATION);
  assert.equal(anchor.answeredAtIso, "2026-08-15T10:00:30.000Z");
  assert.equal(anchor.unclearReason, null);
});

// ---- E) die Obergrenze hat EINE Wahrheit -----------------------------------------------
// ELEVENLABS_PROVIDER_MAX_DURATION_S ist die Zahl, die cancel_call dem Aufrufer nennt
// ("die Leitung kann noch bis zu N Sekunden laufen"). Derselbe Wert steht als SOLL in der
// Agenten-Vorlage und wird von `npm run elevenlabs:drift` gegen den Live-Agenten bewacht.
// Zwei Ablagen fuer eine Zahl driften irgendwann auseinander - und dann nennt cancel_call
// eine Grenze, die beim Anbieter gar nicht mehr gilt. Genau das faengt dieser Test: er
// bindet die Konstante an die besessene Vorlage. Wer den Deckel aendert, muss beide Orte
// anfassen, und die Bewachung sorgt dafuer, dass die Vorlage zum Anbieter passt.
test("EL-Deckel: die Konstante fuer cancel_call ist an den besessenen Vorlagenwert gebunden", async () => {
  const { readFile } = await import("node:fs/promises");
  const vorlage = JSON.parse(
    await readFile(new URL("../elevenlabs/agent_configs/outbound-agent.template.json", import.meta.url), "utf8"),
  );
  // Schrittweise statt gekettet: die Vorlage ist tief verschachtelt, und eine
  // durchgezogene Kette reisst die Demeter-Grenze (G36).
  const gespraechsteil = vorlage.agent.conversation_config;
  const sollWert = gespraechsteil.conversation.max_duration_seconds;
  assert.equal(
    ELEVENLABS_PROVIDER_MAX_DURATION_S,
    sollWert,
    "cancel_call nennt eine andere Obergrenze als die, die am Anbieter besessen und bewacht ist",
  );
});

// ---- F: pollConversationResult braucht eine Obergrenze (Owner-Auftrag 15.08.2026, Aufgabe 2)
// Ohne Riegel behandelt fetchConversationSoft JEDEN Abruffehler (404/429/5xx/Timeout) wie
// "noch nicht fertig" und pollt endlos weiter - nach einem Boot-Re-Arm sogar nach JEDEM
// Neustart erneut (test/el-boot-rearm.test.js belegt den Re-Arm selbst). Dieser Fall belegt
// die Obergrenze SELBST: ein Call, der laenger als ELEVENLABS_PROVIDER_MAX_DURATION_S laeuft,
// UND dessen Anbieter durchgehend unerreichbar bleibt (404 auf jeden Versuch), terminiert
// trotzdem statt weiter zu pollen.
const WAIT_UNTIL_TIMEOUT_MS = 500;
const WAIT_UNTIL_POLL_INTERVAL_MS = 5;

async function waitUntil(predicate, timeoutMs = WAIT_UNTIL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Poll-Obergrenze griff nicht innerhalb der Testfrist");
    await new Promise((resolve) => setTimeout(resolve, WAIT_UNTIL_POLL_INTERVAL_MS));
  }
}

const POLL_ZOMBIE_MARGIN_S = 60; // beliebig, nur "deutlich ueber dem Deckel"

test("Poll-Obergrenze: ein Call aelter als ELEVENLABS_PROVIDER_MAX_DURATION_S terminiert statt endlos weiter zu pollen (Anbieter bleibt unerreichbar)", async () => {
  const laengstAbgelaufen = new Date(
    Date.now() - (ELEVENLABS_PROVIDER_MAX_DURATION_S + POLL_ZOMBIE_MARGIN_S) * MS_PER_SECOND,
  ).toISOString();
  const call = {
    id: "call_zombie_poll",
    status: "active",
    elevenlabsConversationId: CONV_ID,
    answeredAt: laengstAbgelaufen,
    startedAt: laengstAbgelaufen,
    endedAt: null,
  };
  const store = {
    ...spyStore(call),
    load: () => ({ calls: [call] }),
    setCallEndedAt: (_id, status, endedAtIso) => {
      call.status = status;
      call.endedAt = endedAtIso;
    },
  };
  let billed = false;
  const el = makeElevenLabsOutbound({
    store,
    config: elConfig(),
    terminateAndBillCall,
    billThunk: () => () => {
      billed = true;
    },
    finishCall: () => {},
  });
  await withFetch(
    async () => ({ ok: false, status: HTTP_UNPROCESSABLE }), // Anbieter bleibt fuer JEDEN Versuch unerreichbar
    async () => {
      el.rearmActiveConversationPolls();
      // Gewartet wird auf "gebucht" (der LETZTE Schritt von terminateAndBillCall), nicht
      // auf den Statuswechsel allein: persistEnd() laeuft synchron VOR dem hangUp-Versuch
      // (endActiveCall, awaited) - ein Warten auf den blossen Status waere ein Race gegen
      // die noch laufende Buchung.
      await waitUntil(() => billed);
    },
  );
  assert.equal(call.status, "failed", "terminiert statt endlos weiterzupollen");
  assert.ok(billed, "die Buchungskette laeuft auch fuer den Zombie-Zweig der Poll-Obergrenze");
});
