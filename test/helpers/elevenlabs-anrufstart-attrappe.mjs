import assert from "node:assert/strict";

export const PIN_TENANT = "tenant-pin";
export const PIN_FROM = "+15550000001";
const FAKE_CONVERSATION_ID = "conv_pin_test";
const FAKE_RESULT_POLL_MS = 5;

const PIN_NUMBER = Object.freeze({
  e164: PIN_FROM,
  tenantId: PIN_TENANT,
  status: "active",
  provider: "telnyx",
});

const PIN_STATE = Object.freeze({
  tenants: [{ id: PIN_TENANT, defaultLanguage: "de" }],
  settings: {},
  numbers: [PIN_NUMBER],
});

export function pinCall() {
  return {
    id: "call-pin-1",
    tenantId: PIN_TENANT,
    direction: "outbound",
    status: "active",
    from: PIN_FROM,
    to: "+491737250000",
    goal: "Termin vereinbaren",
    constraints: "hoechstens 40 Euro zusagen",
    context: {
      summary: "Rueckruf wegen Reklamation",
      recipient_relationship: "Kundendienst",
      desired_outcome: "Ersatztermin",
      key_facts: ["Vertragsnummer 123", "bereits einmal verschoben"],
    },
    briefing: "Kunde hat bereits zweimal angerufen.",
    mandate: {
      decide_freely: "Ersatztermin frei waehlen",
      fallback_order: "sonst Nachricht hinterlassen",
    },
  };
}

export function pinStore({
  profil = { allowConsult: true },
  tenantContext = () => ({ ownerName: "Pin Testowner", firstName: "Pin" }),
} = {}) {
  return {
    tenantContext,
    tenantTimezone: () => "Europe/Berlin",
    load: () => PIN_STATE,
    numberRecordByE164: (e164) => (e164 === PIN_FROM ? PIN_NUMBER : null),
    resolveProfile: () => profil,
    recordElevenlabsConversationId: () => {},
    recordSipCallId: () => {},
    recordElDetectorCounts: () => {},
    recordFromRegistrationSource: () => {},
    recordActualSender: () => {},
    markAnswered: () => {},
    getCall: () => null,
  };
}

export const PIN_PLATTFORM_STIMME = "pin-plattform-stimme";

export function pinConfig() {
  return {
    voice: {
      elevenLabsToolToken: "pin-tool-token",
      elevenLabsOutbound: {
        apiKey: "pin-test-key",
        agentId: "pin-agent",
        agentPhoneNumberId: "pin-phnum",
        apiBase: "https://pin-test.invalid",
        resultPollMs: FAKE_RESULT_POLL_MS,
      },
    },
    telnyx: { telnyxElevenLabs: { voiceId: PIN_PLATTFORM_STIMME } },
    safety: { fakeOriginateElevenlabs: false },
  };
}

export async function sendeAnrufstartKoerper({
  makeElevenLabsOutbound,
  consultAllowedForCall,
  store = pinStore(),
  lookupAvailableFor,
  call = pinCall(),
}) {
  const originalFetch = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ conversation_id: FAKE_CONVERSATION_ID }) };
  };

  try {
    const { originateCall } = makeElevenLabsOutbound({
      store,
      config: pinConfig(),
      terminateAndBillCall: async () => {},
      billThunk: () => async () => {},
      finishCall: async () => {},
      consultAllowedForCall,
      lookupAvailableFor,
    });
    await originateCall(call);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(capturedBody, "kein Anrufstart ausgeloest - die Attrappe hat keinen Request gesehen");
  return capturedBody;
}

export async function sendeAnrufstart(args) {
  const koerper = await sendeAnrufstartKoerper(args);
  const rumpf = koerper.conversation_initiation_client_data;
  assert.ok(rumpf?.dynamic_variables, "dynamic_variables fehlt im gesendeten Rumpf");
  return rumpf.dynamic_variables;
}
