import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { endConversation, REQUEST_TIMEOUT_MS } from "../src/elevenlabs/convai.js";
import {
  makeElevenLabsOutbound,
  answeredAnchorOutcome,
  ELEVENLABS_PROVIDER_MAX_DURATION_S,
  EL_ABORT_PROVIDER_TIMEOUT_MS,
  PERMANENT_ERROR_STREAK_LIMIT,
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
import { waitUntil, withFetch } from "./helpers.js";
import { CONVERSATION_DONE_WITH_ANALYSIS, ERROR_ENVELOPES } from "./fixtures/elevenlabs-conversations.js";

const ACCOUNT = { apiKey: "test-key", apiBase: "https://el.test" };
const CONV_ID = "conv_1";
const HTTP_OK = 200;
const HTTP_UNPROCESSABLE = 422;
const HTTP_SERVER_ERROR = 500;
const ONE_HOUR_MS = 3600000;
const elConfig = () => withConfigNamespaces({ elevenLabsOutbound: ACCOUNT });

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

function spyStore(call) {
  const order = [];
  return {
    order,
    getCall: () => call,
    addTranscript: () => order.push("addTranscript"),
    recordProviderCallResult: () => order.push("recordProviderCallResult"),
    recordProviderCollectedFields: () => {},
    recordCalleeConfirmedTimezone: () => {},
    recordSipCallId: () => {},
    recordElDetectorCounts: () => {},
    recordFromRegistrationSource: () => {},
    recordActualSender: () => {},
    trueUpAnsweredAt: () => order.push("trueUpAnsweredAt"),
    recordAnsweredUnclearReason: () => order.push("recordAnsweredUnclearReason"),
    recordFailureReason: () => {},
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

test("S1-3: EL_ABORT_PROVIDER_TIMEOUT_MS ist deutlich kuerzer als das Bestands-Zeitlimit", () => {
  assert.ok(
    EL_ABORT_PROVIDER_TIMEOUT_MS < REQUEST_TIMEOUT_MS,
    "die Abbruch-Pfad-Frist muss kuerzer sein als convai.js REQUEST_TIMEOUT_MS (120000ms)",
  );
});

test("S1-3: endActiveCall nutzt fuer BEIDE Anbieter-Aufrufe EL_ABORT_PROVIDER_TIMEOUT_MS statt der 120s-Bestandsfrist", async () => {
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
    [EL_ABORT_PROVIDER_TIMEOUT_MS, EL_ABORT_PROVIDER_TIMEOUT_MS],
    "BEIDE Anbieter-Aufrufe des Abbruch-Pfades (GET Ergebnisabruf, DELETE Loeschversuch) nutzen die kurze Abbruch-Frist",
  );
});

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
        line.includes("Buchungsanker ohne Anbieter-Dauer") &&
        line.includes(call.id) &&
        line.includes("call_duration_secs_unusable"),
    ),
    "der unklare Fall bleibt NICHT still - Fehlerebene-Log mit callId und Grund",
  );
});

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

function elShapedCall(id) {
  return {
    id,
    status: "active",
    provider: "telnyx",
    elevenlabsConversationId: CONV_ID,
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
  lifecycle.rearmActiveCallTimers();
  await billedP;
  assert.deepEqual(endCalls, [call.id], "der EL-Beende-Versuch lief genau einmal fuer den EL-Call");
});

function baseRouteDeps(store, extra) {
  return {
    store,
    config: withConfigNamespaces({ multiTenant: false, elevenLabsOutbound: { enabled: true } }),
    audit: () => {},
    outboundGates: [],
    voiceControl: () => ({ async endCall() {}, async endCallViaCallControl() {} }),
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

test("EL-Deckel: die Konstante fuer cancel_call ist an den besessenen Vorlagenwert gebunden", async () => {
  const { readFile } = await import("node:fs/promises");
  const vorlage = JSON.parse(
    await readFile(new URL("../elevenlabs/agent_configs/outbound-agent.template.json", import.meta.url), "utf8"),
  );
  const gespraechsteil = vorlage.agent.conversation_config;
  const sollWert = gespraechsteil.conversation.max_duration_seconds;
  assert.equal(
    ELEVENLABS_PROVIDER_MAX_DURATION_S,
    sollWert,
    "cancel_call nennt eine andere Obergrenze als die, die am Anbieter besessen und bewacht ist",
  );
});

const WAIT_UNTIL_POLL_INTERVAL_MS = 5;

const POLL_ZOMBIE_MARGIN_S = 60;

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
    async () => ({ ok: false, status: HTTP_UNPROCESSABLE }),
    async () => {
      el.rearmActiveConversationPolls();
      await waitUntil(() => billed);
    },
  );
  assert.equal(call.status, "failed", "terminiert statt endlos weiterzupollen");
  assert.ok(billed, "die Buchungskette laeuft auch fuer den Zombie-Zweig der Poll-Obergrenze");
});

const PERMANENT_ERROR_FAELLE = [
  { id: "404 (unbekannte Kennung)", envelope: ERROR_ENVELOPES.notFound },
  { id: "401 (falscher Schluessel)", envelope: ERROR_ENVELOPES.unauthorizedBadKey },
];

for (const fall of PERMANENT_ERROR_FAELLE) {
  test(`F2 (${fall.id}): DAUERHAFTER Fehler stoppt den Poll erst NACH PERMANENT_ERROR_STREAK_LIMIT Versuchen IN FOLGE, nicht beim ersten`, async () => {
    const geradeErst = new Date().toISOString();
    const call = {
      id: `call_permanent_${fall.envelope.httpStatus}`,
      status: "active",
      elevenlabsConversationId: CONV_ID,
      answeredAt: geradeErst,
      startedAt: geradeErst,
      endedAt: null,
    };
    const reasons = [];
    const store = {
      ...spyStore(call),
      load: () => ({ calls: [call] }),
      setCallEndedAt: (_id, status, endedAtIso) => {
        call.status = status;
        call.endedAt = endedAtIso;
      },
      recordAnsweredUnclearReason: (_id, reason) => reasons.push(reason),
    };
    let billed = false;
    let pollAttempts = 0;
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
      async () => {
        if (call.status === "active") pollAttempts += 1;
        return { ok: false, status: fall.envelope.httpStatus, json: async () => fall.envelope.body };
      },
      async () => {
        el.rearmActiveConversationPolls();
        await waitUntil(() => billed);
      },
    );
    assert.equal(call.status, "failed", "DAUERHAFT stoppt den Poll, statt endlos weiterzupollen");
    assert.equal(
      pollAttempts,
      PERMANENT_ERROR_STREAK_LIMIT,
      `${pollAttempts} statt ${PERMANENT_ERROR_STREAK_LIMIT} Poll-Versuche - VOR der Schwelle muss ` +
        "weiterversucht werden (ein einzelner Fehler darf nicht sofort aufgeben) UND NACH der Schwelle " +
        "ist Schluss (kein weiterer Poll-Versuch mehr)",
    );
    assert.deepEqual(
      reasons,
      ["poll_permanent_provider_error"],
      "der Grund wird festgehalten (recordAnsweredUnclearReason), nicht nur der Status geaendert",
    );
  });
}

test("F3: ein ungemessener Fehlerstatus (500) bleibt VORUEBERGEHEND - der Poll haelt durch, bis das echte Ergebnis da ist", async () => {
  const geradeErst = new Date().toISOString();
  const call = {
    id: "call_transient_recovery",
    status: "active",
    elevenlabsConversationId: CONV_ID,
    answeredAt: geradeErst,
    startedAt: geradeErst,
    endedAt: null,
  };
  const store = {
    ...spyStore(call),
    load: () => ({ calls: [call] }),
    setCallEndedAt: (_id, status, endedAtIso) => {
      call.status = status;
      call.endedAt = endedAtIso;
    },
    endCallRecord: (_id, status) => {
      call.status = status;
      call.endedAt = new Date().toISOString();
      return call;
    },
  };
  let billed = false;
  let getAttempts = 0;
  const TRANSIENT_FAILURES_BEFORE_SUCCESS = 2;
  const el = makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({
      elevenLabsOutbound: { ...ACCOUNT, resultPollMs: WAIT_UNTIL_POLL_INTERVAL_MS },
    }),
    terminateAndBillCall,
    billThunk: () => () => {
      billed = true;
    },
    finishCall: () => {},
  });
  await withFetch(
    async (_url, init) => {
      if (init.method !== "GET") return { ok: true, status: HTTP_OK };
      getAttempts += 1;
      if (getAttempts <= TRANSIENT_FAILURES_BEFORE_SUCCESS) return { ok: false, status: HTTP_SERVER_ERROR };
      return { ok: true, status: HTTP_OK, json: async () => CONVERSATION_DONE_WITH_ANALYSIS };
    },
    async () => {
      el.rearmActiveConversationPolls();
      await waitUntil(() => billed);
    },
  );
  assert.ok(
    getAttempts > TRANSIENT_FAILURES_BEFORE_SUCCESS,
    "der Poll muss ueber die 500er hinweg erneut versuchen",
  );
  assert.equal(call.status, "completed", "das ECHTE Ergebnis kommt an, sobald der Anbieter antwortet");
});
