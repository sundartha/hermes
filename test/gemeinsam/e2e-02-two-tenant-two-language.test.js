import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, postTelnyxIncoming, postElRueckfall, seedCall } from "../helpers.js";
import { makeCallFinish } from "../../src/telephony/call-finish.js";
import { makeDefaultState, registerTenant, setTenantGeo } from "../../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";

const DID_A = "+4915100000101";
const DID_B = "+12025550101";
const AT = "2026-01-01T00:00:00Z";

function twoTenantSeed() {
  const s = makeDefaultState();
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
  setTenantGeo(s, "t_a_de", { defaultLanguage: "de" });
  setTenantGeo(s, "t_b_en", { defaultLanguage: "en" });
  s.numbers.push(
    { id: "num_a", e164: DID_A, tenantId: "t_a_de", provider: "telnyx", status: "active", providerNumberId: null },
    { id: "num_b", e164: DID_B, tenantId: "t_b_en", provider: "telnyx", status: "active", providerNumberId: null },
  );
  return s;
}

test("Inbound-Greeting - Tenant B (Einstellung en) spricht deutsch, die Einstellung wirkt nicht (ex E2E-02, Issue #5986 Kriterium 7)", async () => {
  const srv = await startServer({ seed: twoTenantSeed() });
  try {
    const [resA, resB] = await Promise.all([
      postTelnyxIncoming(srv, { to: DID_A, callSid: "CAe2e02a" }),
      postTelnyxIncoming(srv, { to: DID_B, callSid: "CAe2e02b" }),
    ]);
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    assert.match(await resA.text(), /<Dial/);
    assert.match(await resB.text(), /<Dial/);
    const { calls } = srv.readStore();
    const callIdVon = (sid) => calls.find((call) => call.twilioSid === sid).id;
    const xmlA = await (await postElRueckfall(srv, { callId: callIdVon("CAe2e02a") })).text();
    const xmlB = await (await postElRueckfall(srv, { callId: callIdVon("CAe2e02b") })).text();
    assert.match(xmlA, /KI-Assistent/, "Tenant A (DE) spricht deutsch");
    assert.match(xmlB, /KI-Assistent/, "Tenant B (language=en) startet auf der Startsprache deutsch");
    assert.doesNotMatch(xmlB, /AI assistant/, `Einstellung en wirkt bei eingehenden Anrufen nicht (war "${xmlB}")`);
  } finally {
    await srv.stop();
  }
});

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
    markInboxEntry: () => {},
  };
}

function makeHarness({ summarizeCall, smsCapture, notifyCapture }) {
  const config = { billing: { paymentEnabled: false, smsCostCents: 0 }, privacy: {} };
  const store = makeFakeStore(notifyCapture);
  return makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
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

test("Zusammenfassung - Tenant B (EN) traegt kein 'Anruf' in der Benachrichtigung (ex E2E-02)", async () => {
  const smsA = [];
  const smsB = [];
  const notifyA = [];
  const notifyB = [];
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
  const finishA = makeHarness({ summarizeCall: async () => ({ summary: "Zusammenfassung", actionItems: [] }), smsCapture: smsA, notifyCapture: notifyA });
  const finishB = makeHarness({ summarizeCall: async () => ({ summary: "Call summary", actionItems: [] }), smsCapture: smsB, notifyCapture: notifyB });

  await Promise.all([finishA.finishCall(callA), finishB.finishCall(callB)]);

  assert.equal(smsA.length, 0);
  assert.equal(smsB.length, 0);
  assert.equal(notifyA.length, 1);
  assert.equal(notifyB.length, 1);
  assert.match(notifyA[0].body, /Anruf/, "Tenant A (DE) darf weiterhin 'Anruf' tragen");
  assert.doesNotMatch(
    notifyB[0].body,
    /Anruf/,
    `SOLL: Tenant B (language=en) darf kein 'Anruf' in der Benachrichtigung tragen (war "${notifyB[0].body}")`,
  );
});
