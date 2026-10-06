import express from "express";
import * as ops from "../../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/store/defaults.js";

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
    voice: {
      elevenLabsInbound: { enabled: false },
      inboundOwnerGreetingEnabled: false,
      inboundOwnerGreetingTenantIds: [],
    },
  };
}

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
    tenantPrivateNumber: (tenantId) => ops.tenantPrivateNumber(state, tenantId),
    addTranscript: (callId, role, text) => ops.addTranscript(state, callId, role, text),
    getCall: (id) => ops.getCall(state, id),
    recordCostProfile: (callId, profil) => ops.recordCostProfile(state, callId, profil).call,
    load: () => state,
  };
}

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
