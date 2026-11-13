import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { makeVoiceRoutes } from "../src/routes/voice.js";
import { makeLeitungsplaetze, speicherBereiche } from "../src/store.js";
import * as ops from "../src/store/state-ops.js";
import { INBOUND_EL_SCOPE } from "../src/elevenlabs/inbound-scope.js";
import { LOCALES } from "../src/i18n/locales.js";
import { makeVoiceRender } from "../src/telephony/voice-render.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";

const ANRUF = "call_anrufe_b_1";
const MANDANT = "t_anrufe_b";
const NUMMER = "+4930123456";
const OWNER = "Frieda";
const LANG_GEHEIMNIS = "g".repeat(32);

const ANRUFE = [
  ["addTranscript", [ANRUF, "agent", "Hallo"], { id: ANRUF }],
  ["countNoSpeechTurn", [ANRUF], 2],
  ["clearNoSpeechStreak", [ANRUF], undefined],
  ["numberRecordByE164", [NUMMER], { e164: NUMMER }],
  ["resolveCallLanguage", [{ tenantId: MANDANT, numberRecord: null }], "fr"],
];

const MANDANT_TABELLE = [["tenantContext", [MANDANT], { ownerName: OWNER, settings: {} }]];

const TABELLEN = { anrufe: ANRUFE, mandant: MANDANT_TABELLE };

function attrappe(tabelle) {
  const aufrufe = [];
  const speicher = {};
  for (const [name, , ergebnis] of tabelle) {
    speicher[name] = (...args) => {
      aufrufe.push([name, ...args]);
      return ergebnis;
    };
  }
  return { speicher, aufrufe };
}

for (const [bereich, tabelle] of Object.entries(TABELLEN)) {
  test(`${bereich}: jede Bereichsfunktion liefert ein Promise mit Argumenten und Ergebnis der Speicherfunktion`, async () => {
    const { speicher, aufrufe } = attrappe(tabelle);
    const funktionen = speicherBereiche(speicher)[bereich];
    assert.deepEqual(Object.keys(funktionen), tabelle.map(([name]) => name));
    for (const [name, args, ergebnis] of tabelle) {
      const antwort = funktionen[name](...args);
      assert.ok(antwort instanceof Promise, name);
      assert.deepEqual(await antwort, ergebnis, name);
    }
    assert.deepEqual(aufrufe, tabelle.map(([name, args]) => [name, ...args]));
  });

  test(`${bereich}: Speicherfunktionen werden erst beim Aufruf gelesen und ein Wurf wird zur Ablehnung`, async () => {
    const { speicher } = attrappe(tabelle);
    const funktionen = speicherBereiche(speicher)[bereich];
    const [name, args] = tabelle[0];
    speicher[name] = () => "spaet";
    assert.equal(await funktionen[name](...args), "spaet");
    speicher[name] = () => {
      throw new Error("kaputt");
    };
    await assert.rejects(funktionen[name](...args), /kaputt/);
  });
}

function routenKonfiguration(elInbound) {
  return {
    billing: { voiceTariffInboundCents: 6, defaultTenantBudgetCents: 150000, platformSpendCapCents: 300000, budgetMonthEnabled: false },
    safety: { capFarewellLeadMs: 0, skipTwilioSignatureCheck: true },
    server: { publicUrl: "https://agent.test" },
    telnyx: { telnyxElevenLabs: { voiceId: "" } },
    voice: { elevenLabsInbound: elInbound, inboundOwnerGreetingEnabled: false, inboundOwnerGreetingTenantIds: [] },
  };
}

function speicherAus(state) {
  return {
    numberRecordByE164: (e164) => ops.numberRecordByE164(state, e164),
    resolveCallLanguage: (args) => ops.resolveCallLanguage(state, args),
    budgetExceeded: (tenantId, cfg) => ops.budgetExceeded(state, tenantId, cfg, new Date().toISOString()),
    tenantBudgetSnapshot: (tenantId, cfg) => ops.tenantBudgetSnapshot(state, tenantId, cfg, new Date().toISOString()),
    createCall: (input) => ops.createCall(state, input),
    markAnswered: (callId) => ops.markAnswered(state, callId),
    tenantContext: (tenantId) => ops.tenantContext(state, "", tenantId),
    tenantPrivateNumber: (tenantId) => ops.tenantPrivateNumber(state, tenantId),
    addTranscript: (callId, role, text) => ops.addTranscript(state, callId, role, text),
    getCall: (id) => ops.getCall(state, id),
    countNoSpeechTurn: (callId) => ops.countNoSpeechTurn(state, callId),
    clearNoSpeechStreak: (callId) => ops.clearNoSpeechStreak(state, callId),
    recordCostProfile: (callId, profil) => ops.recordCostProfile(state, callId, profil).call,
    recordWebhookAnchors: () => {},
    markInboundElFallback: () => {},
    recordFailureReason: () => {},
    leitungsplaetze: makeLeitungsplaetze(),
    save: () => {},
    load: () => state,
  };
}

async function mitRouten({ elInbound = { enabled: false }, nummern = [], gehoert = "" }, lauf) {
  const state = Object.assign(ops.makeDefaultState(), { numbers: nummern });
  const store = speicherAus(state);
  const config = routenKonfiguration(elInbound);
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    makeVoiceRoutes({
      store,
      config,
      audit: () => {},
      voiceRender: makeVoiceRender({ config }),
      directiveSynth: { synthesizeDirectiveAudio: async (_call, directives) => directives },
      ttsStore: { takeOnce: () => null },
      lifecycle: { armMaxDurationTimer() {}, reattachActiveCall: async () => ({ call: null, logUnknown: true }) },
      finishCall: async () => {},
      webhookEvents: () => ({ parseSpeechResult: () => gehoert }),
      providerFromHeaders: () => "telnyx",
      inboundSignatureVerifier: () => ({ verifyInboundSignature: () => true }),
      terminateAndBillCall: async () => {},
      billThunk: () => async () => {},
      inboundBridges: { clearDeadlines() {}, armDeadlines() {} },
    }),
  );
  const server = await new Promise((resolve) => {
    const gestartet = app.listen(0, "127.0.0.1", () => resolve(gestartet));
  });
  try {
    await lauf({ url: `http://127.0.0.1:${server.address().port}`, store, state });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const nummer = (extra = {}) => ({ id: "num_b", e164: NUMMER, tenantId: MANDANT, provider: "telnyx", status: "active", ...extra });

const posten = (url, pfad, felder) =>
  abrufMitFrist(`${url}${pfad}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(felder),
  });

function alsAsynchron(speicher, namen, ergebnisse = {}) {
  const aufrufe = [];
  for (const name of namen) {
    const sync = speicher[name];
    Object.assign(speicher, {
      [name]: async (...args) => {
        aufrufe.push(name);
        await Promise.resolve();
        return name in ergebnisse ? ergebnisse[name](...args) : sync(...args);
      },
    });
  }
  return aufrufe;
}

test("eingehender Anruf: ein asynchroner Speicher liefert Nummer, Sprache, Begruessung, Mitschrift und Kostenprofil", async () => {
  await mitRouten({ nummern: [nummer({ language: "en" })] }, async ({ url, store, state }) => {
    const aufrufe = alsAsynchron(
      store,
      ["numberRecordByE164", "resolveCallLanguage", "tenantContext", "addTranscript", "recordCostProfile"],
      { tenantContext: () => ({ ownerName: OWNER, settings: { greeting: "Hallo bei {owner}" } }) },
    );
    const antwort = await posten(url, "/voice/incoming", { From: "+491700000000", To: NUMMER, CallSid: "CAanrufeb1" });
    const xml = await antwort.text();
    assert.equal(antwort.status, 200);
    assert.match(xml, /Hallo bei Frieda/);
    assert.deepEqual(aufrufe, ["numberRecordByE164", "resolveCallLanguage", "recordCostProfile", "tenantContext", "addTranscript"]);
    assert.equal(state.calls.length, 1);
    const [anruf] = state.calls;
    const [erster] = anruf.transcript;
    assert.equal(anruf.language, "en");
    assert.equal(erster.role, "agent");
    assert.match(erster.text, /Hallo bei Frieda/);
    assert.equal(anruf.costProfile, "telnyx_inbound_budget");
  });
});

test("eingehender Anruf ohne registrierte Nummer: ein asynchroner Speicher bleibt unerreichbar", async () => {
  await mitRouten({}, async ({ url, store, state }) => {
    alsAsynchron(store, ["numberRecordByE164"]);
    const antwort = await posten(url, "/voice/incoming", { From: "+491700000000", To: "+4930999999", CallSid: "CAanrufeb2" });
    assert.match(await antwort.text(), /Diese Nummer ist nicht erreichbar/);
    assert.equal(state.calls.length, 0);
  });
});

test("eingehender Anruf ohne EL-Beleg: der Fehlersatz nennt den Namen aus dem asynchronen Speicher", async () => {
  const elInbound = {
    enabled: true,
    scope: INBOUND_EL_SCOPE.REGISTRIERTE_DIDS,
    sipUser: "sip_anrufe_b",
    sipPassword: LANG_GEHEIMNIS,
    initWebhookToken: LANG_GEHEIMNIS,
    tenantIds: [],
  };
  await mitRouten({ elInbound, nummern: [nummer({ language: "de" })] }, async ({ url, store }) => {
    const aufrufe = alsAsynchron(store, ["tenantContext"], { tenantContext: () => ({ ownerName: OWNER, settings: {} }) });
    const antwort = await posten(url, "/voice/incoming", { From: "+491700000000", To: NUMMER, CallSid: "CAanrufeb3" });
    const xml = await antwort.text();
    assert.equal(antwort.status, 200);
    assert.ok(xml.includes(LOCALES.de.inboundFehlersatz(OWNER).replaceAll("'", "&apos;")), xml);
    assert.deepEqual(aufrufe, ["tenantContext"]);
  });
});

test("Gespraechsrunde ohne Sprache: die Zaehlung kommt aus dem asynchronen Speicher und waehlt die Rueckfrage", async () => {
  await mitRouten({ nummern: [nummer({ language: "de" })] }, async ({ url, store, state }) => {
    await posten(url, "/voice/incoming", { From: "+491700000000", To: NUMMER, CallSid: "CAanrufeb4" });
    const [anruf] = state.calls;
    ops.addTranscript(state, anruf.id, "caller", "Guten Tag");
    const aufrufe = alsAsynchron(store, ["countNoSpeechTurn"]);
    const antwort = await posten(url, `/voice/turn?callId=${anruf.id}`, { CallSid: "CAanrufeb4" });
    const xml = await antwort.text();
    assert.ok(xml.includes(LOCALES.de.noSpeechReprompt), xml);
    assert.ok(!xml.includes(LOCALES.de.noSpeechFarewell.slice(0, 20)), xml);
    assert.deepEqual(aufrufe, ["countNoSpeechTurn"]);
    assert.equal(anruf.noSpeechStreak, 1);
  });
});

test("Gespraechsrunde mit Sprache: die Zaehlung wird aus dem asynchronen Speicher zurueckgesetzt", async () => {
  await mitRouten({ nummern: [nummer({ language: "de" })], gehoert: "Guten Tag" }, async ({ url, store, state }) => {
    await posten(url, "/voice/incoming", { From: "+491700000000", To: NUMMER, CallSid: "CAanrufeb5" });
    const [anruf] = state.calls;
    anruf.noSpeechStreak = 2;
    const aufrufe = alsAsynchron(store, ["clearNoSpeechStreak", "countNoSpeechTurn"]);
    await posten(url, `/voice/turn?callId=${anruf.id}`, { CallSid: "CAanrufeb5" });
    assert.deepEqual(aufrufe, ["clearNoSpeechStreak"]);
    assert.equal(anruf.noSpeechStreak, 0);
  });
});
