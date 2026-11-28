import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { makeVoiceRoutes } from "../../src/routes/voice.ts";
import { speicherBereiche } from "../../src/store.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { startInboundHarness } from "../helpers/inbound-router-harness.js";

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

const FEHLERSATZ_MIT_NAME = "Hier ist der KI-Assistent von Frieda. Es ist ein technischer Fehler aufgetreten, bitte rufen Sie später noch einmal an.";

function ergaenze(store) {
  const anruf = (id) => store.getCall(id);
  Object.assign(store, {
    countNoSpeechTurn: (id) => {
      const call = anruf(id);
      call.noSpeechStreak = (call.noSpeechStreak || 0) + 1;
      return call.noSpeechStreak;
    },
    clearNoSpeechStreak: (id) => {
      anruf(id).noSpeechStreak = 0;
    },
    recordWebhookAnchors: () => {},
    markInboundElFallback: () => {},
    recordFailureReason: () => {},
    save: () => {},
  });
  return store;
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

async function mitHarness(seed, lauf) {
  const harness = await startInboundHarness({ seed });
  try {
    await lauf({ url: harness.url, store: ergaenze(harness.store), state: harness.store.load() });
  } finally {
    await harness.stop();
  }
}

function eigeneKonfiguration(elInbound) {
  return {
    billing: { voiceTariffInboundCents: 6, defaultTenantBudgetCents: 150000, platformSpendCapCents: 300000, budgetMonthEnabled: false },
    safety: { capFarewellLeadMs: 0, skipTwilioSignatureCheck: true },
    server: { publicUrl: "https://agent.test" },
    telnyx: { telnyxElevenLabs: { voiceId: "" } },
    voice: { elevenLabsInbound: elInbound, inboundOwnerGreetingEnabled: false, inboundOwnerGreetingTenantIds: [] },
  };
}

const ELEVENLABS_ZUGANG = {
  enabled: true,
  scope: "registrierte_dids",
  sipUser: "sip_anrufe_b",
  sipPassword: LANG_GEHEIMNIS,
  initWebhookToken: LANG_GEHEIMNIS,
  tenantIds: [],
};

async function mitEigenenRouten({ elInbound, gehoert = "" }, seed, lauf) {
  const harness = await startInboundHarness({ seed });
  const store = ergaenze(harness.store);
  const rendern = (directives) => JSON.stringify(directives);
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    makeVoiceRoutes({
      store,
      config: eigeneKonfiguration(elInbound),
      audit: () => {},
      voiceRender: {
        render: rendern,
        turnDirectives: () => [],
        sayInCallVoice: () => ({}),
        followupTurnDirectives: () => [],
      },
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
    await lauf({ url: `http://127.0.0.1:${server.address().port}`, store, state: store.load() });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await harness.stop();
  }
}

test("eingehender Anruf ohne registrierte Nummer: ein asynchroner Speicher bleibt unerreichbar", async () => {
  await mitHarness({}, async ({ url, store, state }) => {
    alsAsynchron(store, ["numberRecordByE164"]);
    const antwort = await posten(url, "/voice/incoming", { From: "+491700000000", To: "+4930999999", CallSid: "CAanrufeb2" });
    assert.match(await antwort.text(), /Diese Nummer ist nicht erreichbar/);
    assert.equal(state.calls.length, 0);
  });
});

test("eingehender Anruf ohne EL-Beleg: der Fehlersatz nennt den Namen aus dem asynchronen Speicher", async () => {
  await mitEigenenRouten({ elInbound: ELEVENLABS_ZUGANG }, { numbers: [nummer({ language: "de" })] }, async ({ url, store }) => {
    const aufrufe = alsAsynchron(store, ["tenantContext"], { tenantContext: () => ({ ownerName: OWNER, settings: {} }) });
    const uebergabe = await posten(url, "/voice/incoming", { From: "+491700000000", To: NUMMER, CallSid: "CAanrufeb3" });
    assert.match(await uebergabe.text(), /dial_sip/);
    aufrufe.length = 0;
    const [{ id: callId }] = store.load().calls;
    const antwort = await abrufMitFrist(`${url}/voice/el-rueckfall?callId=${callId}`, { method: "POST" });
    const text = await antwort.text();
    assert.equal(antwort.status, 200);
    assert.ok(text.includes(FEHLERSATZ_MIT_NAME), text);
    assert.deepEqual(aufrufe, ["tenantContext"]);
  });
});
