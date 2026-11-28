import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, postTelnyxIncoming, seedCall } from "../helpers.js";
import { makeCallFinish } from "../../src/telephony/call-finish.js";
import { makeDefaultState, registerTenant } from "../../src/store/state-ops.js";
import { requestNumberForPaidTenant } from "../../src/billing/provision-trigger.ts";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";

const HIGH = 100;
const TENANT_ID = "t_e2e04";
const AT = "2026-01-01T00:00:00Z";

test("Inbound-Greeting auf der resultierenden US-DID ist englisch (ex E2E-04)", async () => {
  const s = makeDefaultState();
  s.numbers.push({
    id: "num_owner",
    e164: "+4915199999998",
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: "telnyx",
    status: "active",
    providerNumberId: null,
  });
  registerTenant(s, TENANT_ID, { firstName: "Web", lastName: "Login" });
  const r = requestNumberForPaidTenant(s, {
    tenantId: TENANT_ID,
    maxNumbers: HIGH,
    maxNumbersPerTenant: HIGH,
  });
  r.wert.number.status = "active";
  r.wert.number.e164 = "+12025550188";

  const srv = await startServer({ seed: s });
  try {
    const res = await postTelnyxIncoming(srv, { to: "+12025550188", callSid: "CAe2e04" });
    assert.equal(res.status, 200);
    const xml = await res.text();
    assert.doesNotMatch(
      xml,
      /Guten Tag|Hallo|kann gerade nicht/,
      `SOLL: US-DID-Tenant darf keine deutsche Begruessung bekommen (war "${xml}")`,
    );
  } finally {
    await srv.stop();
  }
});

test("Zusammenfassung fuer den US-DID-Tenant enthaelt kein 'Anruf' (ex E2E-04)", async () => {
  const s = makeDefaultState();
  registerTenant(s, TENANT_ID, { firstName: "Web", lastName: "Login" });
  const smsCapture = [];
  const notifyCapture = [];
  const store = {
    withStoreLock: (fn) => fn(),
    releaseOutboundReserve: async () => {},
    save: () => {},
    addNotification: (title, body) => notifyCapture.push({ title, body }),
    purgeTranscript: () => {},
    tenantContext: () => ({ settings: { agentName: "Hermes" } }),
    recordUsageEvent: () => {},
    markBilled: () => {},
    markInboxEntry: () => {},
  };
  const callFinish = makeCallFinish({
    store,
    config: { billing: { paymentEnabled: false, smsCostCents: 0 }, privacy: {} },
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async ({ body }) => smsCapture.push(body) }),
    summarizeCall: async () => ({ summary: "Call summary", actionItems: [] }),
    audit: () => {},
  });

  const call = seedCall({
    tenantId: TENANT_ID,
    language: "en",
    direction: "outbound",
    status: "completed",
    to: "+12025550199",
    transcript: [{ role: "caller", text: "Hi", at: AT }],
  });
  await callFinish.finishCall(call);

  assert.equal(smsCapture.length, 0);
  assert.equal(notifyCapture.length, 1);
  assert.doesNotMatch(
    notifyCapture[0].body,
    /Anruf/,
    `SOLL: Benachrichtigung eines US-DID-Tenants darf kein 'Anruf' enthalten (war "${notifyCapture[0].body}")`,
  );
});
