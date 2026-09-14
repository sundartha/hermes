// In-Process-Mount von makeVoiceRoutes ohne src/boot.js: ein echter Spawn-Server
// (test/helpers.js#startServer) bindet frueh an config.js/store/json.js-Singletons
// (DATA_DIR beim ersten Import) - dieser Harness braucht diese Bindung nicht und
// mountet die Route direkt auf einer nackten Express-App.
//
// Store: EIN In-Memory-Zustand ueber src/store/state-ops.js DIREKT (nicht json.js).
// state-ops.js ist IMPORT-FREI von config.js (reine In-Memory-Operationen auf
// einem uebergebenen state-Objekt, s. Modulkopf dort) - kein Singleton, kein
// Bindungszeitpunkt, der zu spaet kommen kann. Diese Datei baut den Store deshalb direkt
// aus state-ops.js: EIN state-Objekt je Aufruf (ops.makeDefaultState(), mit dem
// optionalen seed vereinigt), Store-Methoden sind duenne Closures darueber - dieselbe
// Fachlogik wie json.js/pg.js, nur ohne deren Datei-/DB-Persistenz, die dieser Harness
// nicht braucht (die Assertions lesen den Call direkt aus dem state-Objekt).
//
// Config: EIN Hand-Mock der Namespaces, die der Inbound-Pfad tatsaechlich liest
// (billing.*, safety.*, server.publicUrl) - aus demselben Grund wie oben: die echte
// config.js waere ein weiterer Singleton mit genau demselben Zu-frueh-gebunden-Risiko.
// makeVoiceRoutes ist eine reine DI-Factory (config kommt als Parameter, s. Modulkopf
// src/routes/voice.js) - der Anfrage-Pfad bekommt NIE etwas anderes zu sehen als diesen Mock.
import express from "express";
import * as ops from "../../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/store/defaults.js";

// Reicht fuer den Inbound-Pfad (/voice/incoming): grosszuegige
// Kosten-/Zeit-Werte, damit budgetExceeded/brakeSecondsFor niemals faelschlich greifen -
// dieser Harness testet das KOSTENPROFIL an der Weiche, nicht die Budget-Gates (die
// haben ihre eigenen Tests).
function makeHarnessConfig() {
  return {
    billing: {
      voiceTariffInboundCents: 6,
      defaultTenantBudgetCents: 150000,
      platformSpendCapCents: 300000,
      budgetMonthEnabled: false,
    },
    safety: { capFarewellLeadMs: 0, skipTwilioSignatureCheck: true },
    server: { publicUrl: "https://agent.test" },
  };
}

// Store-Fassade als duenne Closures ueber state-ops.js (Muster json.js/pg.js-Wrapper,
// nur ohne Persistenz - reines In-Memory, s. Modulkopf). Nur die Methoden, die der
// Inbound-Pfad (/voice/incoming) tatsaechlich aufruft.
function makeHarnessStore(state) {
  return {
    numberRecordByE164: (e164) => ops.numberRecordByE164(state, e164),
    resolveCallLanguage: (args) => ops.resolveCallLanguage(state, args),
    budgetExceeded: (tenantId, cfg) => ops.budgetExceeded(state, tenantId, cfg, new Date().toISOString()),
    tenantBudgetSnapshot: (tenantId, cfg) =>
      ops.tenantBudgetSnapshot(state, tenantId, cfg, new Date().toISOString()),
    createCall: (input) => ops.createCall(state, input),
    markAnswered: (callId) => ops.markAnswered(state, callId),
    tenantContext: (tenantId) => ops.tenantContext(state, "", tenantId),
    addTranscript: (callId, role, text) => ops.addTranscript(state, callId, role, text),
    getCall: (id) => ops.getCall(state, id),
    recordCostProfile: (callId, profil) => ops.recordCostProfile(state, callId, profil).call,
    // Direkter Lesezugriff fuer Testfaelle (Muster json.js#load): dasselbe state-Objekt,
    // das die Closures oben mutieren - kein zweiter Spiegel.
    load: () => state,
  };
}

// No-op-Stubs fuer Abhaengigkeiten, die der Inbound-Pfad ENTWEDER gar nicht erreicht
// (webhookEvents/terminateAndBillCall/billThunk/finishCall werden nie aufgerufen) ODER
// deren echtes Verhalten fuer diesen Pfad irrelevant ist (ttsStore bedient nur
// GET /voice/tts/:token, den kein Testfall dieser Kette anfragt).
function noopDeps() {
  return {
    directiveSynth: { synthesizeDirectiveAudio: async (_call, directives) => directives },
    ttsStore: { takeOnce: () => null },
    lifecycle: {
      armMaxDurationTimer() {},
      reattachActiveCall: async () => ({ call: null, logUnknown: true }),
    },
    finishCall: async () => {},
    webhookEvents: () => ({ parseSpeechResult: () => "" }),
    providerFromHeaders: () => "telnyx",
    inboundSignatureVerifier: () => ({ verifyInboundSignature: () => true }),
    terminateAndBillCall: async () => {},
    billThunk: () => async () => {},
  };
}

// startInboundHarness({seed, configureState}) -> {url, store, stop}.
// seed ist ein optionaler Ausschnitt des state-ops-Shapes (Muster ops.makeDefaultState())
// - typischerweise { numbers: [...] } fuer eine aktive Nummer; er wird ÜBER
// ops.makeDefaultState() gelegt (Object.assign, flache Top-Level-Felder), nicht gegen
// das JSON-Store-Seed-Shape aus test/helpers.js#seedState (das ist die Datei-Vorstufe
// von json.js, hier ohne Gegenstueck - dieser Harness persistiert nichts).
// configureState (optional) laeuft NACH dem seed-Merge auf dem echten state-Objekt -
// fuer Faelle, die eine state-ops-Mutation statt eines flachen Feld-Ueberschreibens
// brauchen (z.B. ops.updateSettings fuer settings.language, weil settings eine
// tenantId-gekeyte Map ist, kein flaches Top-Level-Feld).
export async function startInboundHarness({ seed = {}, configureState } = {}) {
  const state = Object.assign(ops.makeDefaultState(), seed);
  if (configureState) configureState(state);
  const store = makeHarnessStore(state);
  const config = makeHarnessConfig();
  const { makeVoiceRoutes } = await import("../../src/routes/voice.js");
  const { makeVoiceRender } = await import("../../src/telephony/voice-render.js");

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  const router = makeVoiceRoutes({
    store,
    config,
    audit: () => {},
    voiceRender: makeVoiceRender({ config }),
    ...noopDeps(),
  });
  app.use(router);

  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        store,
        stop: () => new Promise((resolveStop) => server.close(resolveStop)),
      });
    });
  });
}

// ownerNumberSeed(number) -> { numbers: [...] }-Ausschnitt fuer startInboundHarness'
// seed-Parameter: eine aktive Owner-Nummer des Bootstrap-Tenants. Gemeinsamer Helfer
// statt drei identischer Inline-Objekte (G5/S2) - ein kuenftiges Pflichtfeld am
// number-Datensatz wird so an EINER Stelle ergaenzt, nicht an dreien vergessen.
export function ownerNumberSeed(number) {
  return {
    numbers: [
      {
        id: "num_owner_seed",
        e164: number.e164,
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: number.provider,
        status: "active",
      },
    ],
  };
}

export { BOOTSTRAP_TENANT_ID };
