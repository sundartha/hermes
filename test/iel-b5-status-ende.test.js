// ---- IEL-B5: Status-Callback und Beenden fuer ueberbrueckte Inbound-Beine -----------------
// Ein ueberbrueckter Inbound-Call (Kostenprofil telnyx_inbound_el_convai, GEBUNDEN) wird
// weder vom /voice/status-Callback noch von Cap/Geld-Wache/cancel_call vor dem Transkript
// abgeschlossen: der Status-Callback setzt nur das Carrier-Ende und startet den Nachlauf-Poll;
// die Beender legen das Traeger-Bein auf und holen danach das Ergebnis (nie DELETE).
//
// Im Prozess (1-16): echte state-ops, echter finishCall, echte EL-Fabrik, echter Lifecycle,
// echte Routen (Harness test/_iel-inbound-harness.js). Kindprozess (17-20): echter Server,
// Anbieter-Attrappe als HTTP-Server - belegt die Verdrahtung in server.js/app.js.
//
// Namen beginnen mit "IEL-B5-<n>: " - trifft weder i18nCatalogPattern noch abnahmePattern,
// laeuft also in npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { voiceMinutesOf } from "../src/billing/metering.js";
import { KOSTENPROFIL } from "../src/billing/kostenarten.js";
import { EL_TERMINATION_RESULT_ATTEMPTS } from "../src/elevenlabs/outbound.js";
import { makeCallRoutes } from "../src/routes/api-calls.js";
import { makeVoiceRoutes } from "../src/routes/voice.js";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { telnyxWebhookEvents } from "../src/telephony/adapters/telnyx/webhook-events.js";
import { BUDGET_FAILURE_REASON, CAP_FAILURE_REASON, makeCallLifecycle } from "../src/telephony/call-lifecycle.js";
import {
  billThunk,
  elevenLabsHangUpAction,
  hangUpAction,
  hangUpForCall,
  terminateAndBillCall,
} from "../src/telephony/call-termination.js";
import { reattachActiveCall as reattachActiveCallCore } from "../src/telephony/reattach.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { CONVERSATION_DONE_WITH_ANALYSIS, CONVERSATION_IN_PROGRESS } from "./fixtures/elevenlabs-conversations.js";
import { captureConsole, seedCall, seedState, startServer, waitForLog, waitForStoreState, waitUntil, withFetch } from "./helpers.js";
import {
  CONV_ID,
  FIXTURE_ZEILEN,
  INBOUND_FROM,
  INBOUND_TO,
  RUHE_TAKTE,
  TRAEGER_SID,
  WARTE,
  baueHarness,
  isoVor,
  makeAnbieter,
  mitAnbieter,
  okAntwort,
  ruhe,
  seedInboundElCall,
  starteAnbieterAttrappe,
} from "./_iel-inbound-harness.js";

// Die lokalen Routen-Aufrufe gehen am echten fetch vorbei an der Anbieter-Attrappe, die
// withFetch fuer den Ergebnisabruf installiert.
const echterFetch = globalThis.fetch;

const EL_INBOUND = KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI;
const GESPRAECH_S = 240;
const ENDE_NACH_S = 90;
const CAP_S = 400;
const NACHLAUF_VOR_CAP_S = 300;
const MINUTEN_BIS_MARKER = 2;
const TAKT_MS = 15000;
const NACHLAUF_LOG = "[el-inbound] nachlauf gestartet";
const NACHLAUF_LOG_MUSTER = /\[el-inbound\] nachlauf gestartet/;
const EINMAL = 1;
const ZWEIMAL = 2;

// ---- Build: Datensaetze ------------------------------------------------------------------

// Budget-Inbound (heutiger Weg) mit denselben Ankern wie seedInboundElCall.
function seedBudgetInboundCall(state, { answeredVorS }) {
  const call = ops.createCall(state, {
    direction: "inbound",
    from: INBOUND_FROM,
    to: INBOUND_TO,
    twilioSid: TRAEGER_SID,
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  call.startedAt = isoVor(answeredVorS);
  call.answeredAt = call.startedAt;
  ops.recordCostProfile(state, call.id, KOSTENPROFIL.TELNYX_INBOUND_BUDGET);
  return call;
}

// WARTET: Profil gesetzt, der Agent hat sich noch nicht gebunden.
function seedWartenderInboundCall(state) {
  const call = seedBudgetInboundCall(state, { answeredVorS: GESPRAECH_S });
  call.costProfile = EL_INBOUND;
  return call;
}

function seedRueckfallCall(state) {
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S });
  ops.markInboundElFallback(state, call.id, new Date().toISOString());
  return call;
}

function seedOutboundElCall(state) {
  const call = ops.createCall(state, { direction: "outbound", from: INBOUND_TO, to: INBOUND_FROM, tenantId: BOOTSTRAP_TENANT_ID });
  call.elevenlabsConversationId = CONV_ID;
  call.startedAt = isoVor(GESPRAECH_S);
  call.answeredAt = call.startedAt;
  return call;
}

function seedZombie(state, { nachlaufVorS = null } = {}) {
  const call = seedInboundElCall(state, { answeredVorS: CAP_S, nachlaufVorS });
  call.maxDurationS = CAP_S;
  return call;
}

// ---- Build: Tor (haelt einen Abruf offen) ------------------------------------------------
function haltAbrufFest(anbieter) {
  let freigeben;
  const tor = new Promise((resolve) => {
    freigeben = resolve;
  });
  anbieter.setzeAntwort(() => tor);
  return (antwort) => freigeben(antwort);
}

const fertig = async () => okAntwort(CONVERSATION_DONE_WITH_ANALYSIS);
const laeuftNoch = async () => okAntwort(CONVERSATION_IN_PROGRESS);

// ---- Build: Bank (Harness + Lifecycle + Voice- und Cancel-Route) -------------------------

function baueLifecycle({ harness, folge }) {
  const budgetTimers = [];
  const lifecycle = makeCallLifecycle({
    store: harness.store,
    config: withConfigNamespaces({ billing: {}, budgetWatchdogIntervalMs: TAKT_MS }),
    finishCall: harness.callFinish.finishCall,
    releaseReserve: () => {},
    voiceControl: () => ({
      endCall: async (sid) => folge.push(["endCall", sid]),
      endCallViaCallControl: async () => {},
    }),
    terminateAndBillCall,
    hangUpAction,
    billThunk,
    endActiveCall: harness.el.endActiveCall,
    awaitAndPersistInboundElResult: harness.el.awaitAndPersistInboundElResult,
    reattachActiveCallCore,
    cappedEndedAtMs: ops.cappedEndedAtMs,
    classifyCallTime: ops.classifyCallTime,
    // Die Achse sperrt: nur rearmBudgetWatchdogs + ein manuell gefeuerter Takt fragen sie.
    blockingBudgetAxis: () => "tenant",
    setBudgetWatchTimer: (fn) => {
      budgetTimers.push(fn);
      return { unref() {} };
    },
  });
  return { lifecycle, budgetTimers };
}

function baueVoiceRoutes({ harness, lifecycle }) {
  return makeVoiceRoutes({
    store: harness.store,
    config: withConfigNamespaces({ skipTwilioSignatureCheck: true }),
    audit: () => {},
    voiceRender: { render: () => "", turnDirectives: () => [], sayInCallVoice: () => null, followupTurnDirectives: () => [] },
    directiveSynth: { synthesizeDirectiveAudio: async (_call, directives) => directives },
    ttsStore: { takeOnce: async () => null },
    lifecycle,
    finishCall: harness.callFinish.finishCall,
    webhookEvents: () => telnyxWebhookEvents,
    providerFromHeaders: () => null,
    inboundSignatureVerifier: () => ({ verifyInboundSignature: () => false }),
    terminateAndBillCall,
    billThunk,
    startInboundNachlauf: harness.el.startInboundNachlauf,
  });
}

function baueCancelRoutes({ harness, folge }) {
  return makeCallRoutes({
    store: harness.store,
    config: withConfigNamespaces({ multiTenant: false, elevenLabsOutbound: { enabled: false } }),
    audit: () => {},
    outboundGates: [],
    voiceControl: () => ({
      endCall: async (sid) => folge.push(["endCall", sid]),
      endCallViaCallControl: async () => {},
    }),
    terminateAndBillCall,
    hangUpAction,
    elevenLabsHangUpAction,
    endActiveCall: harness.el.endActiveCall,
    awaitAndPersistInboundElResult: harness.el.awaitAndPersistInboundElResult,
    billThunk,
    finishCall: harness.callFinish.finishCall,
    arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
    tenant: { requestTenant: () => null, requireTenant: () => null, tenantOwnsCall: () => true },
    consultDelivery: { waitForEvent: async () => ({}) },
    internalIdentity: () => null,
    OWNER_ID: "owner",
  });
}

async function lausche(app) {
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function baueBank(state) {
  const harness = baueHarness(state);
  const folge = [];
  const { lifecycle, budgetTimers } = baueLifecycle({ harness, folge });
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(baueVoiceRoutes({ harness, lifecycle }));
  app.use(baueCancelRoutes({ harness, folge }));
  const server = await lausche(app);
  // Ein failed/cancelled-Abschluss faehrt kein summarizeCall - der Beleg "Ergebnis vor der
  // Buchung" ist deshalb die Transkriptlaenge im Moment von markBilled.
  const transkriptBeiBuchung = [];
  const { markBilled } = harness.store;
  harness.store.markBilled = (id) => {
    const { transcript } = harness.store.getCall(id);
    transkriptBeiBuchung.push(transcript.length);
    return markBilled(id);
  };
  return {
    harness,
    transkriptBeiBuchung,
    lifecycle,
    folge,
    traegerAuflegen: () => folge.filter(([art]) => art === "endCall").map(([, sid]) => sid),
    postStatus: (callId, status) =>
      echterFetch(`${server.url}/voice/status?callId=${callId}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ CallStatus: status }).toString(),
      }),
    postCancel: async (callId) => (await echterFetch(`${server.url}/api/calls/${callId}/cancel`, { method: "POST" })).json(),
    feuereGeldWache: async () => {
      budgetTimers.pop()();
      await new Promise((resolve) => setImmediate(resolve));
    },
    close: server.close,
  };
}

// Faehrt run() mit Bank und Attrappe und raeumt die Bank auch im Fehlerfall ab.
async function mitBank({ state, anbieter }, run) {
  const bank = await baueBank(state);
  try {
    await mitAnbieter({ state, anbieter }, () => run(bank));
  } finally {
    await bank.close();
  }
  return bank;
}

// Wie viele Transkriptzeilen sah summarizeCall beim (ersten) Abschluss?
function rollenDerErstenZusammenfassung([zusammenfassung]) {
  return zusammenfassung.rollen.length;
}

const warteAufBuchung = (bank) => waitUntil(() => bank.harness.gebucht.length === EINMAL, WARTE);

// ---- 1 - 3: reine Auswahl ----------------------------------------------------------------

test("IEL-B5-1: hangUpForCall laesst KEIN_EL_INBOUND, WARTET und RUECKFALL unveraendert, GEBUNDEN bekommt den Bruecken-Thunk", async () => {
  const state = ops.makeDefaultState();
  const traeger = () => {};
  const geholt = [];
  const awaitAndPersistInboundElResult = async (callId) => geholt.push(callId);
  for (const call of [seedBudgetInboundCall(state, { answeredVorS: 1 }), seedWartenderInboundCall(state), seedRueckfallCall(state)])
    assert.equal(hangUpForCall({ call, hangUp: traeger, awaitAndPersistInboundElResult }), traeger);

  const gebunden = seedInboundElCall(state, { answeredVorS: 1 });
  const bruecke = hangUpForCall({ call: gebunden, hangUp: traeger, awaitAndPersistInboundElResult });
  assert.notEqual(bruecke, traeger);
  assert.equal(typeof bruecke, "function");

  const nurErgebnis = hangUpForCall({ call: gebunden, hangUp: null, awaitAndPersistInboundElResult });
  await nurErgebnis();
  assert.deepEqual(geholt, [gebunden.id]);
});

test("IEL-B5-2: Bruecken-Thunk legt erst den Traeger auf und holt dann das Ergebnis - auch wenn der Traeger wirft", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: 1 });
  const reihenfolge = [];
  const awaitAndPersistInboundElResult = async () => reihenfolge.push("ergebnis");

  await hangUpForCall({ call, hangUp: async () => reihenfolge.push("traeger"), awaitAndPersistInboundElResult })();
  assert.deepEqual(reihenfolge, ["traeger", "ergebnis"]);

  reihenfolge.length = 0;
  const kaputt = async () => {
    throw new Error("traeger kaputt");
  };
  await assert.rejects(hangUpForCall({ call, hangUp: kaputt, awaitAndPersistInboundElResult })(), /traeger kaputt/);
  assert.deepEqual(reihenfolge, ["ergebnis"]);
});

test("IEL-B5-3: elevenLabsHangUpAction liefert fuer Inbound-EL nie einen DELETE-Thunk, fuer denselben Call ohne Profil schon", () => {
  const state = ops.makeDefaultState();
  const endActiveCall = async () => {};
  for (const call of [seedInboundElCall(state, { answeredVorS: 1 }), seedRueckfallCall(state)])
    assert.equal(elevenLabsHangUpAction(endActiveCall, call), null);

  const ohneProfil = { ...seedInboundElCall(state, { answeredVorS: 1 }), costProfile: null };
  assert.equal(typeof elevenLabsHangUpAction(endActiveCall, ohneProfil), "function");
});

// ---- 4: begrenztes Ergebnis-Warten -------------------------------------------------------

test("IEL-B5-4: awaitAndPersistInboundElResult wartet begrenzt, persistiert ohne DELETE und ohne Anbieter-Zusammenfassung", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S });
  const harness = baueHarness(state);
  const antwortFolge = [laeuftNoch, fertig];
  const antworten = [...antwortFolge];
  const anbieter = makeAnbieter(() => antworten.shift()());
  await withFetch(anbieter.fetch, () => harness.el.awaitAndPersistInboundElResult(call.id));
  assert.equal(anbieter.gets, antwortFolge.length);
  assert.equal(anbieter.deletes, 0);
  assert.equal(call.transcript.length, FIXTURE_ZEILEN);
  assert.equal(call.summary, null);

  const nieFertig = seedInboundElCall(state, { answeredVorS: GESPRAECH_S });
  const dauerLaeufer = makeAnbieter(laeuftNoch);
  await withFetch(dauerLaeufer.fetch, () => harness.el.awaitAndPersistInboundElResult(nieFertig.id));
  assert.equal(dauerLaeufer.gets, EL_TERMINATION_RESULT_ATTEMPTS);
  assert.equal(nieFertig.transcript.length, 0);

  const wartend = seedWartenderInboundCall(state);
  const unberuehrt = makeAnbieter(fertig);
  await withFetch(unberuehrt.fetch, () => harness.el.awaitAndPersistInboundElResult(wartend.id));
  assert.equal(unberuehrt.gets, 0);
});

// ---- 5 - 9: /voice/status ----------------------------------------------------------------

test("IEL-B5-5: Status -> Poll - completed setzt nur das Carrier-Ende, der Poll schliesst mit Transkript vor finishCall ab", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S });
  const anbieter = makeAnbieter(laeuftNoch);

  const bank = await mitBank({ state, anbieter }, async (laufend) => {
    await laufend.postStatus(call.id, "completed");
    assert.ok(call.elNachlaufStartedAt, "Marker gesetzt");
    assert.equal(call.status, "active");
    assert.equal(laufend.harness.gebucht.length, 0);
    anbieter.setzeAntwort(fertig);
    await waitUntil(() => laufend.harness.gebucht.length === EINMAL && call.transcript.length === 0, WARTE);
    await ruhe(RUHE_TAKTE);
  });

  const { zusammenfassungen, detektorZaehlungen, gebucht } = bank.harness;
  assert.equal(zusammenfassungen.length, EINMAL);
  assert.equal(rollenDerErstenZusammenfassung(zusammenfassungen), FIXTURE_ZEILEN);
  assert.equal(detektorZaehlungen.length, EINMAL);
  assert.equal(gebucht.length, EINMAL);
  assert.equal(call.endedAt, call.elNachlaufStartedAt);
  assert.equal(call.transcript.length, 0);
});

test("IEL-B5-5P: Positiv-Kontrolle - derselbe Status-Callback schliesst einen Budget-Inbound sofort ab", async () => {
  const state = ops.makeDefaultState();
  const call = seedBudgetInboundCall(state, { answeredVorS: GESPRAECH_S });
  const anbieter = makeAnbieter(fertig);

  await mitBank({ state, anbieter }, async (bank) => {
    await bank.postStatus(call.id, "completed");
    await waitUntil(() => Boolean(call.billedAt), WARTE);
  });

  assert.equal(anbieter.gets, 0);
  assert.equal(call.elNachlaufStartedAt, null);
});

test("IEL-B5-6: Status -> Status - die zweite Zustellung startet keine zweite Schleife, eine Log-Zeile, ein Abschluss", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S });
  const anbieter = makeAnbieter(laeuftNoch);
  let bank;

  const zeilen = await captureConsole(async () => {
    bank = await mitBank({ state, anbieter }, async (laufend) => {
      const freigeben = haltAbrufFest(anbieter);
      await laufend.postStatus(call.id, "completed");
      await waitUntil(() => anbieter.offen === EINMAL, WARTE);
      const marker = call.elNachlaufStartedAt;
      await laufend.postStatus(call.id, "completed");
      await ruhe(RUHE_TAKTE);
      assert.equal(anbieter.offen, EINMAL, "die zweite Zustellung laeuft in keinen eigenen Abruf");
      assert.equal(call.elNachlaufStartedAt, marker);
      anbieter.setzeAntwort(fertig);
      freigeben(okAntwort(CONVERSATION_DONE_WITH_ANALYSIS));
      await warteAufBuchung(laufend);
      await ruhe(RUHE_TAKTE);
    });
  });

  assert.equal(zeilen.filter((zeile) => zeile.includes(NACHLAUF_LOG)).length, EINMAL);
  assert.equal(bank.harness.detektorZaehlungen.length, EINMAL);
  assert.equal(bank.harness.gebucht.length, EINMAL);
  assert.equal(rollenDerErstenZusammenfassung(bank.harness.zusammenfassungen), FIXTURE_ZEILEN);
});

test("IEL-B5-7: Poll -> Status - ein nach dem Abschluss eintreffender Status-Callback bucht und schreibt nichts mehr", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S });
  const anbieter = makeAnbieter(fertig);

  const bank = await mitBank({ state, anbieter }, async (laufend) => {
    laufend.harness.el.rearmActiveConversationPolls();
    await warteAufBuchung(laufend);
    await ruhe(RUHE_TAKTE);
    const getsVorStatus = anbieter.gets;
    await laufend.postStatus(call.id, "completed");
    await ruhe(RUHE_TAKTE);
    assert.equal(anbieter.gets, getsVorStatus);
  });

  assert.equal(bank.harness.gebucht.length, EINMAL);
  assert.equal(bank.harness.zusammenfassungen.length, EINMAL);
  assert.notEqual(call.status, "active");
  assert.equal(call.transcript.length, 0);
});

test("IEL-B5-8: laufender Re-Arm-Poll -> Status - keine zweite Schleife, genau ein Abschluss", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S });
  const anbieter = makeAnbieter(laeuftNoch);

  const bank = await mitBank({ state, anbieter }, async (laufend) => {
    laufend.harness.el.rearmActiveConversationPolls();
    await waitUntil(() => anbieter.gets >= ZWEIMAL, WARTE);
    const freigeben = haltAbrufFest(anbieter);
    await waitUntil(() => anbieter.offen === EINMAL, WARTE);
    await laufend.postStatus(call.id, "completed");
    await ruhe(RUHE_TAKTE);
    assert.equal(anbieter.offen, EINMAL, "der Status-Callback startet keine zweite Schleife");
    anbieter.setzeAntwort(fertig);
    freigeben(okAntwort(CONVERSATION_DONE_WITH_ANALYSIS));
    await warteAufBuchung(laufend);
    await ruhe(RUHE_TAKTE);
  });

  assert.equal(bank.harness.zusammenfassungen.length, EINMAL);
  assert.equal(bank.harness.gebucht.length, EINMAL);
  assert.equal(anbieter.maxOffen, EINMAL);
});

test("IEL-B5-9: Negativ-Tabelle - WARTET, RUECKFALL und Outbound-EL schliessen wie heute ab, ohne Marker und ohne Abruf", async () => {
  for (const seed of [seedWartenderInboundCall, seedRueckfallCall, seedOutboundElCall]) {
    const state = ops.makeDefaultState();
    const call = seed(state);
    const anbieter = makeAnbieter(fertig);

    await mitBank({ state, anbieter }, async (bank) => {
      await bank.postStatus(call.id, "completed");
      await waitUntil(() => Boolean(call.billedAt), WARTE);
    });

    assert.equal(call.elNachlaufStartedAt, null, seed.name);
    assert.equal(anbieter.gets, 0, seed.name);
  }
});

// ---- 10 - 12: Cap und Geld-Wache ---------------------------------------------------------

test("IEL-B5-10: Cap -> Status - Traeger aufgelegt, Ergebnis vor der Buchung persistiert, kein DELETE, genau eine Buchung", async () => {
  const state = ops.makeDefaultState();
  const call = seedZombie(state);
  const anbieter = makeAnbieter(laeuftNoch);
  const freigeben = haltAbrufFest(anbieter);

  const bank = await mitBank({ state, anbieter }, async (laufend) => {
    laufend.lifecycle.rearmActiveCallTimers();
    await waitUntil(() => anbieter.offen === EINMAL, WARTE);
    await laufend.postStatus(call.id, "completed");
    await ruhe(RUHE_TAKTE);
    freigeben(okAntwort(CONVERSATION_DONE_WITH_ANALYSIS));
    await warteAufBuchung(laufend);
    await ruhe(RUHE_TAKTE);
  });

  assert.deepEqual(bank.traegerAuflegen(), [TRAEGER_SID]);
  assert.equal(anbieter.deletes, 0);
  assert.deepEqual(bank.transkriptBeiBuchung, [FIXTURE_ZEILEN], "Ergebnis stand vor der Buchung am Datensatz");
  assert.equal(bank.harness.detektorZaehlungen.length, EINMAL);
  assert.equal(bank.harness.gebucht.length, EINMAL);
  assert.equal(call.failureReason, CAP_FAILURE_REASON);
});

test("IEL-B5-11: Cap waehrend des Nachlaufs - Ende-Anker ist der Marker, gebucht wird nur die Carrier-Dauer", async () => {
  const state = ops.makeDefaultState();
  const call = seedZombie(state, { nachlaufVorS: NACHLAUF_VOR_CAP_S });
  const anbieter = makeAnbieter(fertig);

  const bank = await mitBank({ state, anbieter }, async (laufend) => {
    laufend.lifecycle.rearmActiveCallTimers();
    await warteAufBuchung(laufend);
  });

  assert.equal(call.endedAt, call.elNachlaufStartedAt);
  assert.equal(voiceMinutesOf(call), MINUTEN_BIS_MARKER);
  assert.deepEqual(bank.traegerAuflegen(), [TRAEGER_SID]);
});

test("IEL-B5-11P: Positiv-Kontrolle - Budget-Inbound mit denselben Ankern behaelt den heutigen Cap-Anker", async () => {
  const state = ops.makeDefaultState();
  const call = seedBudgetInboundCall(state, { answeredVorS: CAP_S });
  call.maxDurationS = CAP_S;
  const anbieter = makeAnbieter(fertig);

  const bank = await mitBank({ state, anbieter }, async (laufend) => {
    laufend.lifecycle.rearmActiveCallTimers();
    await waitUntil(() => Boolean(call.billedAt), WARTE);
  });

  assert.equal(call.endedAt, new Date(Date.parse(call.answeredAt) + CAP_S * MS_PER_SECOND).toISOString());
  assert.equal(anbieter.gets, 0);
  assert.deepEqual(bank.traegerAuflegen(), [TRAEGER_SID]);
});

test("IEL-B5-12: Geld-Wache -> Poll - der Beende-Thunk persistiert einmal, die Schleife schliesst nicht mehr ab", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S });
  const anbieter = makeAnbieter(laeuftNoch);
  const freigeben = haltAbrufFest(anbieter);

  const bank = await mitBank({ state, anbieter }, async (laufend) => {
    await laufend.postStatus(call.id, "completed");
    await waitUntil(() => anbieter.offen === EINMAL, WARTE);
    anbieter.setzeAntwort(fertig);
    laufend.lifecycle.rearmBudgetWatchdogs();
    await laufend.feuereGeldWache();
    await warteAufBuchung(laufend);
    freigeben(okAntwort(CONVERSATION_DONE_WITH_ANALYSIS));
    await waitUntil(() => anbieter.offen === 0, WARTE);
    await ruhe(RUHE_TAKTE);
  });

  assert.equal(bank.harness.detektorZaehlungen.length, EINMAL);
  assert.equal(bank.harness.zusammenfassungen.length, EINMAL);
  assert.equal(bank.harness.gebucht.length, EINMAL);
  assert.equal(call.failureReason, BUDGET_FAILURE_REASON);
  assert.equal(call.endedAt, call.elNachlaufStartedAt);
  assert.deepEqual(bank.traegerAuflegen(), [TRAEGER_SID]);
  assert.equal(anbieter.deletes, 0);
});

// ---- 13 - 16: cancel_call ----------------------------------------------------------------

test("IEL-B5-13: cancel_call GEBUNDEN - Traeger aufgelegt, Ergebnis vor der Buchung, Kurzantwort, kein DELETE", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S });
  const anbieter = makeAnbieter(fertig);
  let antwort;

  const bank = await mitBank({ state, anbieter }, async (laufend) => {
    antwort = await laufend.postCancel(call.id);
    await warteAufBuchung(laufend);
  });

  assert.deepEqual(antwort, { status: "cancelled" });
  assert.deepEqual(bank.traegerAuflegen(), [TRAEGER_SID]);
  assert.ok(anbieter.gets >= EINMAL);
  assert.equal(anbieter.deletes, 0);
  assert.deepEqual(bank.transkriptBeiBuchung, [FIXTURE_ZEILEN], "Ergebnis stand vor der Buchung am Datensatz");
  assert.equal(bank.harness.gebucht.length, EINMAL);
  assert.equal(call.status, "cancelled");
});

test("IEL-B5-14: cancel_call im Nachlauf - Ende-Anker ist der Marker", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S, nachlaufVorS: ENDE_NACH_S });
  const anbieter = makeAnbieter(fertig);

  await mitBank({ state, anbieter }, async (bank) => {
    await bank.postCancel(call.id);
    await warteAufBuchung(bank);
  });

  assert.equal(call.endedAt, call.elNachlaufStartedAt);
});

test("IEL-B5-15: cancel_call WARTET - Traeger aufgelegt, kein Ergebnisabruf, Ende = jetzt", async () => {
  const teststartMs = Date.now();
  const state = ops.makeDefaultState();
  const call = seedWartenderInboundCall(state);
  const anbieter = makeAnbieter(fertig);
  let antwort;

  const bank = await mitBank({ state, anbieter }, async (laufend) => {
    antwort = await laufend.postCancel(call.id);
    await warteAufBuchung(laufend);
  });

  assert.deepEqual(antwort, { status: "cancelled" });
  assert.deepEqual(bank.traegerAuflegen(), [TRAEGER_SID]);
  assert.equal(anbieter.gets, 0);
  assert.ok(Date.parse(call.endedAt) >= teststartMs);
});

test("IEL-B5-16: cancel_call Budget-Inbound - Kurzantwort, kein Abruf, Store-Folge wie heute (endCallRecord, auflegen, buchen)", async () => {
  const state = ops.makeDefaultState();
  const call = seedBudgetInboundCall(state, { answeredVorS: GESPRAECH_S });
  const anbieter = makeAnbieter(fertig);
  let antwort;

  const bank = await mitBank({ state, anbieter }, async (laufend) => {
    const { store } = laufend.harness;
    const { endCallRecord, setCallEndedAt, markBilled } = store;
    store.endCallRecord = (id, status) => {
      laufend.folge.push(["endCallRecord", status]);
      return endCallRecord(id, status);
    };
    store.setCallEndedAt = (...args) => {
      laufend.folge.push(["setCallEndedAt"]);
      return setCallEndedAt(...args);
    };
    store.markBilled = (id) => {
      laufend.folge.push(["markBilled"]);
      return markBilled(id);
    };
    antwort = await laufend.postCancel(call.id);
    await waitUntil(() => Boolean(call.billedAt), WARTE);
  });

  assert.deepEqual(antwort, { status: "cancelled" });
  assert.equal(anbieter.gets, 0);
  assert.deepEqual(bank.folge, [["endCallRecord", "cancelled"], ["endCall", TRAEGER_SID], ["markBilled"]]);
});

// ---- 17 - 20: Kindprozess (Verdrahtung server.js / app.js) -------------------------------

const SPAWN_CALL_ID = "call_iel_b5";
const SPAWN_FRIST_MS = 15000;
const SPAWN_WARTE = { timeoutMs: SPAWN_FRIST_MS, pollIntervalMs: 20 };
const POLL_TAKT_MS = 500;
const SCHNELLER_TAKT_MS = 100;
const LANGER_TAKT_MS = 60000;
const MINDEST_ABSTAND_ANTEIL = 0.9;
const WEITERE_TAKTE = 2;
const FRISCH_BEANTWORTET_S = 5;
const KURZE_FRIST_S = 3600;

function gebundenerSeed({ answeredVorS = FRISCH_BEANTWORTET_S, maxDurationS = KURZE_FRIST_S, extra = {} } = {}) {
  const answeredAt = isoVor(answeredVorS);
  return seedState({
    // Kein LLM-Netzaufruf in finishCall.
    settings: { allowSummaries: false },
    calls: [
      seedCall({
        id: SPAWN_CALL_ID,
        direction: "inbound",
        provider: "telnyx",
        from: INBOUND_FROM,
        to: INBOUND_TO,
        twilioSid: TRAEGER_SID,
        answeredAt,
        startedAt: answeredAt,
        maxDurationS,
        costProfile: EL_INBOUND,
        elevenlabsConversationId: CONV_ID,
        elBoundAt: new Date().toISOString(),
        ...extra,
      }),
    ],
  });
}

async function mitServer({ env, seed }, run) {
  const attrappe = await starteAnbieterAttrappe();
  const srv = await startServer({
    env: { ELEVENLABS_API_BASE: attrappe.url, ELEVENLABS_API_KEY: "test-key", ...env },
    seed,
  });
  try {
    await run({ srv, attrappe });
  } finally {
    await srv.stop();
    await attrappe.close();
  }
}

const spawnCall = (stand) => stand.calls.find((eintrag) => eintrag.id === SPAWN_CALL_ID);
const postSpawnStatus = (srv, status) =>
  fetch(`${srv.localUrl}/voice/status?callId=${SPAWN_CALL_ID}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ CallStatus: status }).toString(),
  });
const zeilenMit = (srv, marke) => srv.stdout.split(marke).length - EINMAL;

function abstaendeMs(anfragen) {
  return anfragen.slice(1).map((anfrage, index) => anfrage.atMs - anfragen[index].atMs);
}

test("IEL-B5-17: Neustart waehrend GEBUNDEN - Status-Callback startet keine zweite Schleife, Abschluss am Carrier-Ende", async () => {
  await mitServer({ env: { ELEVENLABS_RESULT_POLL_MS: String(POLL_TAKT_MS) }, seed: gebundenerSeed() }, async ({ srv, attrappe }) => {
    await waitUntil(() => attrappe.gets().length >= EINMAL, SPAWN_WARTE);
    await postSpawnStatus(srv, "completed");
    await waitForLog(srv, NACHLAUF_LOG_MUSTER, SPAWN_FRIST_MS);
    const nachStatus = spawnCall(srv.readStore());
    assert.ok(nachStatus.elNachlaufStartedAt);
    assert.equal(nachStatus.status, "active");

    const getsNachStatus = attrappe.gets().length;
    await waitUntil(() => attrappe.gets().length >= getsNachStatus + WEITERE_TAKTE, SPAWN_WARTE);
    assert.equal(spawnCall(srv.readStore()).status, "active");
    for (const abstand of abstaendeMs(attrappe.gets()))
      assert.ok(abstand >= MINDEST_ABSTAND_ANTEIL * POLL_TAKT_MS, `eine Schleife: Abstand ${abstand} ms`);

    attrappe.setzeAntwort(CONVERSATION_DONE_WITH_ANALYSIS);
    const stand = await waitForStoreState(srv, (state) => spawnCall(state).status !== "active" && Boolean(spawnCall(state).billedAt), SPAWN_FRIST_MS);
    const call = spawnCall(stand);
    assert.equal(call.endedAt, nachStatus.elNachlaufStartedAt);
    assert.equal(zeilenMit(srv, NACHLAUF_LOG), EINMAL);
    assert.equal(attrappe.deletes().length, 0);
  });
});

test("IEL-B5-18: Neustart waehrend RUECKFALL - Status-Callback schliesst wie heute ab, kein Abruf, kein Marker", async () => {
  const seed = gebundenerSeed({ extra: { elFallbackAt: new Date().toISOString() } });
  await mitServer({ env: {}, seed }, async ({ srv, attrappe }) => {
    await postSpawnStatus(srv, "completed");
    const erster = spawnCall(await waitForStoreState(srv, (state) => Boolean(spawnCall(state).billedAt), SPAWN_FRIST_MS));
    await postSpawnStatus(srv, "completed");
    await waitUntil(() => zeilenMit(srv, "[voice/status]") >= ZWEIMAL, SPAWN_WARTE);

    const call = spawnCall(srv.readStore());
    assert.equal(attrappe.gets().length, 0);
    assert.equal(call.status, "completed");
    assert.equal(call.billedAt, erster.billedAt);
    assert.equal(call.elNachlaufStartedAt, null);
    assert.equal(zeilenMit(srv, NACHLAUF_LOG), 0);
  });
});

test("IEL-B5-19: Verdrahtung Cap (server.js) - Zombie beim Boot holt das Ergebnis ueber den Bruecken-Thunk, kein DELETE", async () => {
  const env = { FAKE_ORIGINATE: "true", ELEVENLABS_RESULT_POLL_MS: String(SCHNELLER_TAKT_MS) };
  const seed = gebundenerSeed({ answeredVorS: CAP_S, maxDurationS: CAP_S });
  await mitServer({ env, seed }, async ({ srv, attrappe }) => {
    attrappe.setzeAntwort(CONVERSATION_DONE_WITH_ANALYSIS);
    const call = spawnCall(await waitForStoreState(srv, (state) => Boolean(spawnCall(state).billedAt), SPAWN_FRIST_MS));
    assert.ok(attrappe.gets().length >= EINMAL);
    assert.equal(attrappe.deletes().length, 0);
    assert.equal(call.status, "failed");
    assert.deepEqual(call.elDetectorCounts, { elTags: 0, elB1: 0 }, "persistProviderResult lief im Beende-Pfad");
    assert.equal(call.sipCallId, null, "IEX-A1: telnyx_inbound_el_convai fuehrt keinen telnyx_sip-Join-Schluessel");
  });
});

test("IEL-B5-20: Verdrahtung cancel_call (app.js) - Traeger auflegen, Ergebnis holen, kein DELETE", async () => {
  const env = { FAKE_ORIGINATE: "true", ELEVENLABS_RESULT_POLL_MS: String(LANGER_TAKT_MS) };
  await mitServer({ env, seed: gebundenerSeed() }, async ({ srv, attrappe }) => {
    await waitUntil(() => attrappe.gets().length >= EINMAL, SPAWN_WARTE);
    const getsNachBoot = attrappe.gets().length;
    attrappe.setzeAntwort(CONVERSATION_DONE_WITH_ANALYSIS);

    const res = await fetch(`${srv.localUrl}/api/calls/${SPAWN_CALL_ID}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.deepEqual(await res.json(), { status: "cancelled" });
    const call = spawnCall(await waitForStoreState(srv, (state) => Boolean(spawnCall(state).billedAt), SPAWN_FRIST_MS));
    assert.ok(attrappe.gets().length > getsNachBoot);
    assert.equal(attrappe.deletes().length, 0);
    assert.equal(call.status, "cancelled");
  });
});
