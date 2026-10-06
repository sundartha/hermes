import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { KOSTENPROFIL } from "../src/billing/kostenarten.js";
import { BRIDGE_STATE, bridgeStateOf, uebergabeGescheitert } from "../src/elevenlabs/inbound-bridge-state.js";
import { EL_RUECKFALL_QUELLE, elRueckfallUrl } from "../src/elevenlabs/inbound-bridges.js";
import { inboundElLocaleOf } from "../src/elevenlabs/inbound-initiation.js";
import {
  EL_MIN_CONVERSATION_MS,
  RUECKFALL_ENTSCHEIDUNG,
  elFehlersatzDirektiven,
  msSeitBindung,
  rueckfallEntscheidungFuer,
} from "../src/elevenlabs/inbound-rueckfall.js";
import { INBOUND_EL_GRUND, vermerkeUebergabeGescheitert } from "../src/elevenlabs/inbound-uebergabe-gescheitert.js";
import { LOCALES, SUPPORTED_LANGUAGES, localeFor } from "../src/i18n/locales.js";
import { makeVoiceRoutes } from "../src/routes/voice.js";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { telnyxWebhookEvents } from "../src/telephony/adapters/telnyx/webhook-events.js";
import { renderDirectives } from "../src/telephony/adapters/telnyx/render.js";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { billThunk, terminateAndBillCall } from "../src/telephony/call-termination.js";
import { DIRECTIVE, hangup, say } from "../src/telephony/directives.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { storeOpsFacade, waitUntil } from "./helpers.js";
import { CONV_ID, INBOUND_FROM, INBOUND_TO, isoVor, seedInboundElCall, seedWartenderElCall } from "./_iel-inbound-harness.js";

const EL_INBOUND = KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI;
const OWNER_NAME = "Jonas";
const PUBLIC_URL = "https://agent.test";
const AGENT_STIMME = "v_agent";
const FAKE_NOW_MS = Date.parse("2026-09-15T10:00:00.000Z");
const SPAETER_MS = FAKE_NOW_MS + EL_MIN_CONVERSATION_MS;
const BINDUNG_VOR_MS = 1234;
const ALT_GEBUNDEN_S = 10;
const EINMAL = 1;
const HTTP_OK = 200;
const EL_RUECKFALL_LOG = "[el-rueckfall] ";
const EL_UEBERGABE_LOG = "[el-uebergabe]";

const isoAt = (ms) => new Date(ms).toISOString();
const elCall = (extra = {}) => ({ status: "active", costProfile: EL_INBOUND, elFallbackAt: null, elevenlabsConversationId: null, elBoundAt: null, ...extra });
const gebundenerCall = (boundMs, extra = {}) => elCall({ elevenlabsConversationId: CONV_ID, elBoundAt: isoAt(boundMs), ...extra });
const budgetCall = (extra = {}) => ({ status: "active", costProfile: KOSTENPROFIL.TELNYX_INBOUND_BUDGET, ...extra });

const FEHLERSATZ_MIT_NAME = Object.freeze({
  de: "Hier ist der KI-Assistent von Jonas. Es ist ein technischer Fehler aufgetreten, bitte rufen Sie später noch einmal an.",
  en: "This is Jonas's AI assistant. A technical error has occurred, please call again later.",
  fr: "Ici l'assistant IA de Jonas. Une erreur technique est survenue, veuillez rappeler plus tard.",
});
const FEHLERSATZ_OHNE_NAME = Object.freeze({
  de: "Hier ist ein KI-Assistent. Es ist ein technischer Fehler aufgetreten, bitte rufen Sie später noch einmal an.",
  en: "This is an AI assistant. A technical error has occurred, please call again later.",
  fr: "Ici un assistant IA. Une erreur technique est survenue, veuillez rappeler plus tard.",
});
const KEIN_TEXT_NAME = 42;
const LEERE_NAMEN = Object.freeze(["", "   ", null, undefined, KEIN_TEXT_NAME]);

const KONSOLEN_KANAELE = Object.freeze(["log", "warn", "error"]);

async function mitKonsole(run) {
  const zeilen = { log: [], warn: [], error: [] };
  const original = Object.fromEntries(KONSOLEN_KANAELE.map((kanal) => [kanal, console[kanal]]));
  for (const kanal of KONSOLEN_KANAELE) console[kanal] = (...teile) => zeilen[kanal].push(teile.map(String).join(" "));
  try {
    await run(zeilen);
  } finally {
    Object.assign(console, original);
  }
}

const rueckfallLogEintrag = (zeile) => JSON.parse(zeile.slice(EL_RUECKFALL_LOG.length));
const rueckfallLogEintraege = (zeilen) => zeilen.log.filter((zeile) => zeile.startsWith(`${EL_RUECKFALL_LOG}{`)).map(rueckfallLogEintrag);
const uebergabeZeilen = (zeilen) => zeilen.log.filter((zeile) => zeile.startsWith(EL_UEBERGABE_LOG));

test("IEX-A2-1: rueckfallEntscheidungFuer - Enum und Entscheidungstabelle E4", () => {
  assert.deepEqual({ ...RUECKFALL_ENTSCHEIDUNG }, { AUFLEGEN: "auflegen", FOLGE_GATHER: "folge_gather", FEHLERSATZ: "fehlersatz" });
  const { AUFLEGEN, FOLGE_GATHER, FEHLERSATZ } = RUECKFALL_ENTSCHEIDUNG;
  const faelle = [
    ["kein Call", null, AUFLEGEN],
    ["beendet WARTET", elCall({ status: "completed" }), AUFLEGEN],
    ["beendet GEBUNDEN", gebundenerCall(FAKE_NOW_MS, { status: "completed" }), AUFLEGEN],
    ["Budget-Call", budgetCall(), FOLGE_GATHER],
    ["Call ohne Profil", { status: "active", costProfile: null }, FOLGE_GATHER],
    ["RUECKFALL", elCall({ elFallbackAt: isoAt(FAKE_NOW_MS) }), AUFLEGEN],
    ["GEBUNDEN genau an der Grenze", gebundenerCall(FAKE_NOW_MS - EL_MIN_CONVERSATION_MS), AUFLEGEN],
    ["GEBUNDEN knapp unter der Grenze", gebundenerCall(FAKE_NOW_MS - EL_MIN_CONVERSATION_MS + EINMAL), FEHLERSATZ],
    ["WARTET", elCall(), FEHLERSATZ],
    ["GEBUNDEN mit unlesbarem elBoundAt", elCall({ elevenlabsConversationId: CONV_ID, elBoundAt: "kaputt" }), FEHLERSATZ],
  ];
  for (const [name, call, erwartet] of faelle) assert.equal(rueckfallEntscheidungFuer({ call, nowMs: FAKE_NOW_MS }), erwartet, name);
});

test("IEX-A2-2: msSeitBindung - null ohne lesbare Bindung, sonst die Differenz", () => {
  assert.equal(msSeitBindung(elCall(), FAKE_NOW_MS), null);
  assert.equal(msSeitBindung(elCall({ elBoundAt: "kaputt" }), FAKE_NOW_MS), null);
  assert.equal(msSeitBindung(null, FAKE_NOW_MS), null);
  assert.equal(msSeitBindung(gebundenerCall(FAKE_NOW_MS - BINDUNG_VOR_MS), FAKE_NOW_MS), BINDUNG_VOR_MS);
});

test("IEX-A2-3: inboundFehlersatz - Wortlaut O3 je Sprache, getrimmter Name, O4-Form ohne Namen", () => {
  assert.deepEqual([...SUPPORTED_LANGUAGES].sort(), Object.keys(FEHLERSATZ_MIT_NAME).sort());
  for (const sprache of SUPPORTED_LANGUAGES) {
    const fehlersatz = LOCALES[sprache].inboundFehlersatz;
    assert.equal(fehlersatz(OWNER_NAME), FEHLERSATZ_MIT_NAME[sprache], sprache);
    assert.equal(fehlersatz(`  ${OWNER_NAME}  `), FEHLERSATZ_MIT_NAME[sprache], `${sprache} getrimmt`);
    for (const name of LEERE_NAMEN) assert.equal(fehlersatz(name), FEHLERSATZ_OHNE_NAME[sprache], `${sprache} ${JSON.stringify(name)}`);
  }
  assert.ok(LOCALES.de.inboundFehlersatz(OWNER_NAME).startsWith("Hier ist der KI-Assistent von Jonas."));
  assert.ok(LOCALES.en.inboundFehlersatz(OWNER_NAME).startsWith("This is Jonas's AI assistant."));
  assert.ok(LOCALES.fr.inboundFehlersatz(OWNER_NAME).startsWith("Ici l'assistant IA de Jonas."));
});

test("IEX-A2-4: elFehlersatzDirektiven - Say in Agentenstimme + Hangup, kein Gather, kein Dial", () => {
  for (const sprache of SUPPORTED_LANGUAGES) {
    const bundle = LOCALES[sprache];
    const text = bundle.inboundFehlersatz(OWNER_NAME);
    const direktiven = elFehlersatzDirektiven({ text, voiceProfile: bundle.voiceProfile, voiceId: AGENT_STIMME });
    assert.deepEqual(direktiven.map((direktive) => direktive.kind), [DIRECTIVE.SAY, DIRECTIVE.HANGUP], sprache);
    assert.equal(direktiven[0].voiceId, AGENT_STIMME);
    const xml = renderDirectives(direktiven);
    assert.equal(xml, renderDirectives([say(text, bundle.voiceProfile), hangup()]), sprache);
    assert.ok(xml.includes("<Hangup/>") && !xml.includes("<Gather") && !xml.includes("<Dial"), xml);
  }
  const [ohneStimme] = elFehlersatzDirektiven({ text: "x", voiceProfile: LOCALES.de.voiceProfile, voiceId: "" });
  assert.equal(Object.hasOwn(ohneStimme, "voiceId"), false);
});

test("IEX-A2-5: uebergabeGescheitert - Marker ODER nie gebunden, sonst nicht", () => {
  const faelle = [
    ["Budget ohne Marker", budgetCall(), false],
    ["Budget mit Marker", budgetCall({ elFallbackAt: isoAt(FAKE_NOW_MS) }), true],
    ["WARTET", elCall(), true],
    ["GEBUNDEN", gebundenerCall(FAKE_NOW_MS), false],
    ["EL mit Marker (RUECKFALL)", gebundenerCall(FAKE_NOW_MS, { elFallbackAt: isoAt(FAKE_NOW_MS) }), true],
    ["Outbound-EL", { status: "active", costProfile: KOSTENPROFIL.ELEVENLABS_CONVAI, elevenlabsConversationId: CONV_ID }, false],
    ["kein Call", null, false],
  ];
  for (const [name, call, erwartet] of faelle) assert.equal(uebergabeGescheitert(call), erwartet, name);
});

test("IEX-A2-6: vermerkeUebergabeGescheitert - Marker, Grund, Fristen; set-once", () => {
  assert.deepEqual({ ...INBOUND_EL_GRUND }, { EL_UEBERGABE_GESCHEITERT: "el_uebergabe_gescheitert", EL_OHNE_REGISTRIERUNG: "ohne_el_registrierung" });
  const state = ops.makeDefaultState();
  const call = seedWartenderElCall(state, { answeredVorS: 1 });
  const geloescht = [];
  const deps = { store: baueRouteStore(state), inboundBridges: { clearDeadlines: (callId) => geloescht.push(callId) } };

  vermerkeUebergabeGescheitert({ callId: call.id, grund: INBOUND_EL_GRUND.EL_UEBERGABE_GESCHEITERT, nowMs: FAKE_NOW_MS }, deps);
  assert.equal(call.elFallbackAt, isoAt(FAKE_NOW_MS));
  assert.equal(call.failureReason, INBOUND_EL_GRUND.EL_UEBERGABE_GESCHEITERT);
  assert.deepEqual(geloescht, [call.id]);

  vermerkeUebergabeGescheitert({ callId: call.id, grund: INBOUND_EL_GRUND.EL_OHNE_REGISTRIERUNG, nowMs: SPAETER_MS }, deps);
  assert.equal(call.elFallbackAt, isoAt(FAKE_NOW_MS));
  assert.equal(call.failureReason, INBOUND_EL_GRUND.EL_UEBERGABE_GESCHEITERT);
});

function baueRouteState() {
  const state = ops.makeDefaultState();
  state.tenants[0].ownerName = OWNER_NAME;
  state.numbers.push({ id: "num_iex_a2", e164: INBOUND_TO, tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx", status: "active", providerNumberId: null, language: "de" });
  return state;
}

const mitSprache = (call) => Object.assign(call, { language: "de" });
const seedWartend = (state) => mitSprache(seedWartenderElCall(state, { answeredVorS: 1 }));
const seedGebunden = (state) => mitSprache(seedInboundElCall(state, { answeredVorS: 1 }));

function baueRouteStore(state, spione = neueSpione()) {
  const fassade = storeOpsFacade(state);
  return {
    ...fassade,
    markAnswered: (id) => ops.markAnswered(state, id),
    markInboundElFallback: (id, iso) => {
      spione.marker.push(id);
      return ops.markInboundElFallback(state, id, iso);
    },
    recordFailureReason: (id, grund) => {
      spione.gruende.push(grund);
      return fassade.recordFailureReason(id, grund);
    },
    tenantContext: (id) => ops.tenantContext(state, "", id),
    numberRecordByE164: (e164) => ops.numberRecordByE164(state, e164),
  };
}

const ROUTE_CONFIG = () => withConfigNamespaces({ skipTwilioSignatureCheck: true, publicUrl: PUBLIC_URL, telnyxElevenLabs: { voiceId: AGENT_STIMME } });

const nieErwartet = (name) => () => {
  throw new Error(`${name} darf auf diesem Weg nicht laufen`);
};

function baueRouter({ store, spione, ersetzt = {} }) {
  return makeVoiceRoutes({
    store,
    config: ROUTE_CONFIG(),
    audit: () => {},
    voiceRender: { render: (direktiven) => renderDirectives(direktiven), turnDirectives: nieErwartet("turnDirectives"), sayInCallVoice: nieErwartet("sayInCallVoice"), followupTurnDirectives: nieErwartet("followupTurnDirectives") },
    directiveSynth: {
      synthesizeDirectiveAudio: async (_call, direktiven) => {
        spione.synthesen.push(direktiven);
        return direktiven;
      },
    },
    ttsStore: { takeOnce: async () => null },
    lifecycle: { reattachActiveCall: async () => ({ call: null, logUnknown: true }) },
    finishCall: nieErwartet("finishCall"),
    webhookEvents: () => telnyxWebhookEvents,
    providerFromHeaders: () => null,
    inboundSignatureVerifier: () => ({ verifyInboundSignature: () => false }),
    terminateAndBillCall,
    billThunk,
    startInboundNachlauf: nieErwartet("startInboundNachlauf"),
    inboundBridges: { clearDeadlines: (callId) => spione.fristenGeloescht.push(callId) },
    ...ersetzt,
  });
}

function neueSpione() {
  return { marker: [], gruende: [], synthesen: [], fristenGeloescht: [] };
}

async function mitRoute(router, run) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(router);
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  const basis = `http://127.0.0.1:${server.address().port}`;
  const post = async (pfad, felder = {}) => {
    const res = await fetch(`${basis}${pfad}`, { method: "POST", body: new URLSearchParams(felder) });
    assert.equal(res.status, HTTP_OK);
    return res.text();
  };
  try {
    await run(post);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const postRueckfall = (post, { callId, quelle }) => post(elRueckfallUrl({ callId, quelle }));

function fehlersatzOhneAufloesungXml({ language, ownerName }) {
  const bundle = localeFor(language);
  return renderDirectives([say(bundle.inboundFehlersatz(ownerName), bundle.voiceProfile), hangup()]);
}

function pruefeVermerkt(call) {
  assert.ok(call.elFallbackAt, "Marker gesetzt");
  assert.equal(call.failureReason, INBOUND_EL_GRUND.EL_UEBERGABE_GESCHEITERT);
}

test("IEX-A2-7: WARTET + dial_ende -> Fehlersatz in der Init-Stimme, Marker, Grund, Fristen weg, kein Transkript", async () => {
  const state = baueRouteState();
  const call = seedWartend(state);
  const spione = neueSpione();
  const store = baueRouteStore(state, spione);
  const erwarteteStimme = inboundElLocaleOf({ store, config: ROUTE_CONFIG(), call }).voiceId;
  await mitKonsole(async (zeilen) => {
    await mitRoute(baueRouter({ store, spione }), async (post) => {
      const text = await postRueckfall(post, { callId: call.id, quelle: EL_RUECKFALL_QUELLE.DIAL_ENDE });
      const fehlersatz = { text: LOCALES.de.inboundFehlersatz(OWNER_NAME), voiceProfile: LOCALES.de.voiceProfile, voiceId: erwarteteStimme };
      assert.equal(text, renderDirectives(elFehlersatzDirektiven(fehlersatz)));
      assert.deepEqual(spione.synthesen, [elFehlersatzDirektiven(fehlersatz)]);
    });
    pruefeVermerkt(call);
    assert.deepEqual(spione.fristenGeloescht, [call.id]);
    assert.equal(call.transcript.length, 0);
    const [eintrag] = rueckfallLogEintraege(zeilen);
    assert.deepEqual(eintrag, { callId: call.id, quelle: EL_RUECKFALL_QUELLE.DIAL_ENDE, entscheidung: RUECKFALL_ENTSCHEIDUNG.FEHLERSATZ, ms_seit_bindung: null });
    for (const zeile of zeilen.log) for (const nummer of [INBOUND_FROM, INBOUND_TO]) assert.ok(!zeile.includes(nummer), zeile);
  });
});

test("IEX-A2-8: GEBUNDEN jung + frist -> Fehlersatz, Marker; ms_seit_bindung unter der Mindestdauer", async () => {
  const state = baueRouteState();
  const call = seedGebunden(state);
  const spione = neueSpione();
  await mitKonsole(async (zeilen) => {
    await mitRoute(baueRouter({ store: baueRouteStore(state, spione), spione }), async (post) => {
      const text = await postRueckfall(post, { callId: call.id, quelle: EL_RUECKFALL_QUELLE.FRIST });
      assert.ok(text.includes("<Hangup/>") && !text.includes("<Gather"), text);
    });
    pruefeVermerkt(call);
    assert.equal(bridgeStateOf(call), BRIDGE_STATE.RUECKFALL);
    const [eintrag] = rueckfallLogEintraege(zeilen);
    assert.equal(eintrag.entscheidung, RUECKFALL_ENTSCHEIDUNG.FEHLERSATZ);
    assert.equal(typeof eintrag.ms_seit_bindung, "number");
    assert.ok(eintrag.ms_seit_bindung >= 0 && eintrag.ms_seit_bindung < EL_MIN_CONVERSATION_MS, String(eintrag.ms_seit_bindung));
  });
});

test("IEX-A2-9a: Synthese wirft (WARTET) -> Fehlersatz ohne Synthese + Hangup, Marker genau einmal, eine Fehlerzeile", async () => {
  const state = baueRouteState();
  const call = seedWartend(state);
  const spione = neueSpione();
  const ersetzt = { directiveSynth: { synthesizeDirectiveAudio: async () => Promise.reject(new Error("synthese kaputt")) } };
  await mitKonsole(async (zeilen) => {
    await mitRoute(baueRouter({ store: baueRouteStore(state, spione), spione, ersetzt }), async (post) => {
      const text = await postRueckfall(post, { callId: call.id, quelle: EL_RUECKFALL_QUELLE.DIAL_ENDE });
      assert.equal(text, fehlersatzOhneAufloesungXml({ language: "de", ownerName: OWNER_NAME }));
    });
    pruefeVermerkt(call);
    assert.deepEqual(spione.marker, [call.id]);
    assert.equal(zeilen.error.length, EINMAL);
  });
});

test("IEX-A2-9b: reattachActiveCall wirft (unbekannter Call) -> O4-Form + Hangup, keine Store-Schreibung", async () => {
  const state = baueRouteState();
  const spione = neueSpione();
  const ersetzt = { lifecycle: { reattachActiveCall: async () => Promise.reject(new Error("reattach kaputt")) } };
  await mitKonsole(async () => {
    await mitRoute(baueRouter({ store: baueRouteStore(state, spione), spione, ersetzt }), async (post) => {
      const text = await postRueckfall(post, { callId: "call_unbekannt", quelle: EL_RUECKFALL_QUELLE.FRIST });
      assert.equal(text, fehlersatzOhneAufloesungXml({ language: undefined, ownerName: "" }));
    });
  });
  assert.deepEqual(spione.marker, []);
  assert.deepEqual(spione.gruende, []);
});

function renderErsterWurfWirft() {
  let aufrufe = 0;
  return (direktiven) => {
    aufrufe += EINMAL;
    if (aufrufe === EINMAL) throw new Error("render kaputt");
    return renderDirectives(direktiven);
  };
}

test("IEX-A2-9c: GEBUNDEN alt, erster render wirft -> kein Marker (Nachlauf bleibt), Fehlersatz + Hangup", async () => {
  const state = baueRouteState();
  const call = Object.assign(seedGebunden(state), { elBoundAt: isoVor(ALT_GEBUNDEN_S) });
  const spione = neueSpione();
  const voiceRender = { render: renderErsterWurfWirft(), turnDirectives: nieErwartet("turnDirectives"), sayInCallVoice: nieErwartet("sayInCallVoice"), followupTurnDirectives: nieErwartet("followupTurnDirectives") };
  await mitKonsole(async () => {
    await mitRoute(baueRouter({ store: baueRouteStore(state, spione), spione, ersetzt: { voiceRender } }), async (post) => {
      const text = await postRueckfall(post, { callId: call.id, quelle: EL_RUECKFALL_QUELLE.DIAL_ENDE });
      assert.equal(text, fehlersatzOhneAufloesungXml({ language: "de", ownerName: OWNER_NAME }));
    });
  });
  assert.equal(call.elFallbackAt, null);
  assert.deepEqual(spione.marker, []);
});

test("IEX-A2-9d: WARTET, Marker-Schreibung wirft immer -> trotzdem Fehlersatz + Hangup, Fehlerzeile vermerk:", async () => {
  const state = baueRouteState();
  const call = seedWartend(state);
  const spione = neueSpione();
  const store = { ...baueRouteStore(state, spione), markInboundElFallback: nieErwartet("markInboundElFallback") };
  await mitKonsole(async (zeilen) => {
    await mitRoute(baueRouter({ store, spione }), async (post) => {
      const text = await postRueckfall(post, { callId: call.id, quelle: EL_RUECKFALL_QUELLE.DIAL_ENDE });
      assert.equal(text, fehlersatzOhneAufloesungXml({ language: "de", ownerName: OWNER_NAME }));
    });
    assert.ok(zeilen.error.some((zeile) => zeile.startsWith(`${EL_RUECKFALL_LOG}vermerk:`)), zeilen.error.join("\n"));
  });
});

const NACHLAUF_WEGE = Object.freeze(["addNotification", "markInboxEntry", "tenantContext", "purgeTranscript", "summarizeCall", "planSummarySms", "messaging", "audit", "sendMail", "recordVoiceMinuteMeter"]);

function baueAbschluss(state) {
  const zaehler = { buchungen: 0, grundBeiBuchung: [], wege: Object.fromEntries(NACHLAUF_WEGE.map((weg) => [weg, 0])) };
  const zaehle = (weg) => () => {
    zaehler.wege[weg] += EINMAL;
  };
  const store = {
    ...Object.fromEntries(["addNotification", "markInboxEntry", "tenantContext", "purgeTranscript"].map((weg) => [weg, zaehle(weg)])),
    withStoreLock: (fn) => fn(),
    releaseOutboundReserve: async () => {},
    save: () => {},
    load: () => state,
    markBilled: (id) => {
      zaehler.grundBeiBuchung.push(ops.getCall(state, id).failureReason);
      ops.markBilled(state, id);
    },
  };
  const metering = {
    recordVoiceMinuteMeter: zaehle("recordVoiceMinuteMeter"),
    reconcileVoiceBudget: () => {
      zaehler.buchungen += EINMAL;
    },
  };
  const { finishCall } = makeCallFinish({
    store,
    config: { billing: { paymentEnabled: false, smsCostCents: 0 }, privacy: {} },
    metering,
    messaging: zaehle("messaging"),
    summarizeCall: zaehle("summarizeCall"),
    planSummarySms: zaehle("planSummarySms"),
    audit: zaehle("audit"),
    mailer: { sendMail: zaehle("sendMail") },
  });
  return { finishCall, zaehler };
}

const keinNachlauf = (zaehler) => assert.deepEqual(Object.values(zaehler.wege), NACHLAUF_WEGE.map(() => 0), JSON.stringify(zaehler.wege));

function seedFehlersatzCall(state) {
  const call = seedWartend(state);
  ops.markInboundElFallback(state, call.id, isoAt(FAKE_NOW_MS));
  ops.recordFailureReason(state, call.id, INBOUND_EL_GRUND.EL_UEBERGABE_GESCHEITERT);
  ops.addTranscript(state, call.id, "agent", LOCALES.de.inboundNotice);
  ops.endCallRecord(state, call.id, "completed");
  return call;
}

test("IEX-A2-10: finishCall mit Marker - gebucht (Grund vorher), keine Benachrichtigung, eine Logzeile, zweiter Aufruf No-op", async () => {
  const state = baueRouteState();
  const call = seedFehlersatzCall(state);
  const { finishCall, zaehler } = baueAbschluss(state);
  await mitKonsole(async (zeilen) => {
    await finishCall(call);
    await finishCall(call);
    assert.deepEqual(uebergabeZeilen(zeilen), [`${EL_UEBERGABE_LOG} gescheitert call=${call.id} grund=el_uebergabe_gescheitert zustand=rueckfall`]);
  });
  assert.equal(zaehler.buchungen, EINMAL);
  assert.deepEqual(zaehler.grundBeiBuchung, [INBOUND_EL_GRUND.EL_UEBERGABE_GESCHEITERT]);
  keinNachlauf(zaehler);
});

test("IEX-A2-11: Positiv-Kontrolle - Budget-Call ohne Marker, failed, leer -> Notification genau einmal, keine [el-uebergabe]-Zeile", async () => {
  const state = baueRouteState();
  const call = ops.createCall(state, { direction: "inbound", from: INBOUND_FROM, to: INBOUND_TO, tenantId: BOOTSTRAP_TENANT_ID, language: "de" });
  ops.recordCostProfile(state, call.id, KOSTENPROFIL.TELNYX_INBOUND_BUDGET);
  ops.endCallRecord(state, call.id, "failed");
  const { finishCall, zaehler } = baueAbschluss(state);
  await mitKonsole(async (zeilen) => {
    await finishCall(call);
    assert.deepEqual(uebergabeZeilen(zeilen), []);
  });
  assert.equal(zaehler.wege.addNotification, EINMAL);
  assert.equal(zaehler.buchungen, EINMAL);
});

const STATUS_FAELLE = Object.freeze([
  { callStatus: "completed", grund: "keiner" },
  { callStatus: "failed", grund: "failed" },
]);

async function statusZweimal({ state, call, callStatus }, zeilen) {
  const { finishCall, zaehler } = baueAbschluss(state);
  const spione = neueSpione();
  const router = baueRouter({ store: baueRouteStore(state, spione), spione, ersetzt: { finishCall } });
  const statusZeilen = () => zeilen.log.filter((zeile) => zeile.startsWith("[voice/status]")).length;
  await mitRoute(router, async (post) => {
    await post(`/voice/status?callId=${call.id}`, { CallStatus: callStatus });
    await waitUntil(() => uebergabeZeilen(zeilen).length === EINMAL);
    await post(`/voice/status?callId=${call.id}`, { CallStatus: callStatus });
    await waitUntil(() => statusZeilen() > EINMAL);
  });
  return zaehler;
}

test("IEX-A2-12: /voice/status completed/failed auf WARTET ohne Marker - keine Benachrichtigung, Buchung genau einmal", async (ctx) => {
  for (const { callStatus, grund } of STATUS_FAELLE) {
    await ctx.test(`IEX-A2-12 ${callStatus}`, async () => {
      const state = baueRouteState();
      const call = seedWartend(state);
      await mitKonsole(async (zeilen) => {
        const zaehler = await statusZweimal({ state, call, callStatus }, zeilen);
        assert.equal(zaehler.buchungen, EINMAL);
        keinNachlauf(zaehler);
        assert.deepEqual(uebergabeZeilen(zeilen), [`${EL_UEBERGABE_LOG} gescheitert call=${call.id} grund=${grund} zustand=wartet`]);
      });
      assert.ok(call.billedAt);
      assert.equal(call.elFallbackAt, null);
    });
  }
});
