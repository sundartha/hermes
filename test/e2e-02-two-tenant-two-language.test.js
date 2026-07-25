// E2E-02 (i18n-Testkatalog, tasks/i18n-tests/11-luecken-und-e2e.md:901) - Zwei Tenants,
// zwei Sprachen, volle Kette parallel.
//
// SOLL (rot): keine Kreuzkontamination ueber die Rahmentexte - Tenant A (language="de")
// bleibt ausschliesslich Deutsch, Tenant B (language="en") ausschliesslich Englisch. Heute
// tragen Schritt 2 (Inbound-Greeting) UND Schritt 4 (Summary-SMS/Notification) fuer BEIDE
// Tenants dieselben deutschen Rahmentexte - der Greeting-Text (src/routes/voice.js:265)
// ignoriert call.language (WEB-05), der SMS-/Notification-Rahmen (call-finish.js:57,80-81)
// liest call.language ueberhaupt nicht (WEB-14). Zwei Kanaele reichen als Launch-Gate-Beweis:
// Greeting per echtem Server-Spawn (offline, Telnyx-Signatur-Header wie test/telnyx-p8-
// inbound.test.js), SMS/Notification per makeCallFinish-Unit (Muster WEB-14).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, postTelnyxIncoming, seedCall } from "./helpers.js";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { makeDefaultState, registerTenant, settingsFor } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const DID_A = "+4915100000101"; // Tenant A: Deutschland
const DID_B = "+12025550101"; // Tenant B: USA (settings.language="en")
const AT = "2026-01-01T00:00:00Z";

function twoTenantSeed() {
  const s = makeDefaultState();
  // Owner-Tenant braucht eine aktive Nummer (Boot-Guard) - eigene DID, kollidiert nicht
  // mit A/B.
  s.numbers.push({
    id: "num_owner",
    e164: "+4915199999999",
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: "telnyx",
    status: "active",
    providerNumberId: null,
  });
  registerTenant(s, "t_a_de", { firstName: "Anna", lastName: "A" });
  registerTenant(s, "t_b_en", { firstName: "Bob", lastName: "B" });
  s.tenants.find((t) => t.id === "t_a_de").status = "active";
  s.tenants.find((t) => t.id === "t_b_en").status = "active";
  settingsFor(s, "t_a_de").language = "de";
  settingsFor(s, "t_b_en").language = "en";
  s.numbers.push(
    { id: "num_a", e164: DID_A, tenantId: "t_a_de", provider: "telnyx", status: "active", providerNumberId: null },
    { id: "num_b", e164: DID_B, tenantId: "t_b_en", provider: "telnyx", status: "active", providerNumberId: null },
  );
  return s;
}

test("E2E-02 (SOLL rot): Inbound-Greeting - Tenant B (EN) darf keine deutschen Signalwoerter sprechen", async () => {
  const srv = await startServer({ seed: twoTenantSeed() });
  try {
    const [resA, resB] = await Promise.all([
      postTelnyxIncoming(srv, { to: DID_A, callSid: "CAe2e02a" }),
      postTelnyxIncoming(srv, { to: DID_B, callSid: "CAe2e02b" }),
    ]);
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    const xmlA = await resA.text();
    const xmlB = await resB.text();
    assert.match(xmlA, /Guten Tag|Hallo/, "Tenant A (DE) darf weiterhin deutsch begruessen");
    assert.doesNotMatch(
      xmlB,
      /Guten Tag|Hallo|kann gerade nicht/,
      `SOLL: Tenant B (language=en) darf im Greeting kein Deutsch sprechen (war "${xmlB}")`,
    );
  } finally {
    await srv.stop();
  }
});

// ---- SMS/Notification (Schritt 4): direkter makeCallFinish-Unit-Test, ein Aufruf je
// Tenant, parallel. Muster WEB-14.

function makeFakeStore(notifyCapture) {
  return {
    withStoreLock: (fn) => fn(),
    releaseOutboundReserve: async () => {},
    save: () => {},
    addNotification: (title, body, callId) => notifyCapture.push({ title, body, callId }),
    purgeTranscript: () => {},
    tenantContext: () => ({ settings: { agentName: "Hermes" } }),
    recordUsageEvent: () => {},
    markSummarySmsSent: () => {},
    markBilled: () => {},
  };
}

function makeHarness({ summarizeCall, smsCapture, notifyCapture }) {
  const config = { billing: { paymentEnabled: false, smsCostCents: 0 }, privacy: {} };
  const store = makeFakeStore(notifyCapture);
  return makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileOutboundVoiceBudget: () => {} },
    messaging: () => ({
      sendSms: async ({ body }) => {
        smsCapture.push(body);
      },
    }),
    summarizeCall,
    planSummarySms: () => ({
      send: true,
      to: "+10000000000",
      smsFrom: { e164: "+10000000001" },
      reason: null,
    }),
    audit: () => {},
  });
}

test("E2E-02 (SOLL rot): Summary-SMS - Tenant B (EN) darf kein 'Anruf' im SMS-Body tragen", async () => {
  const smsA = [];
  const smsB = [];
  const callA = seedCall({
    id: "call_a",
    tenantId: "t_a_de",
    language: "de",
    direction: "outbound",
    status: "completed",
    to: "+4915100000199",
    transcript: [{ role: "caller", text: "Hallo", at: AT }],
  });
  const callB = seedCall({
    id: "call_b",
    tenantId: "t_b_en",
    language: "en",
    direction: "outbound",
    status: "completed",
    to: "+12025550199",
    transcript: [{ role: "caller", text: "Hi", at: AT }],
  });
  const finishA = makeHarness({ summarizeCall: async () => ({ summary: "Zusammenfassung", actionItems: [] }), smsCapture: smsA, notifyCapture: [] });
  const finishB = makeHarness({ summarizeCall: async () => ({ summary: "Call summary", actionItems: [] }), smsCapture: smsB, notifyCapture: [] });

  await Promise.all([finishA.finishCall(callA), finishB.finishCall(callB)]);

  assert.equal(smsA.length, 1);
  assert.equal(smsB.length, 1);
  assert.match(smsA[0], /Anruf/, "Tenant A (DE) darf weiterhin 'Anruf' tragen");
  assert.doesNotMatch(
    smsB[0],
    /Anruf/,
    `SOLL: Tenant B (language=en) darf kein 'Anruf' im SMS-Body tragen (war "${smsB[0]}")`,
  );
});
