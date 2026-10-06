import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, postTelnyxIncoming, seedCall } from "./helpers.js";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { makeDefaultState, registerTenant, tenantGeo } from "../src/store/state-ops.js";
import { requestNumberForPaidTenant } from "../src/billing/provision-trigger.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const HIGH = 100;
const TENANT_ID = "t_e2e04";
const AT = "2026-01-01T00:00:00Z";

test("Web-Login-Tenant ohne Geo bekommt eine US-DID, language folgt dem Weltdefault (ex E2E-04, Teil 1)", () => {
  const s = makeDefaultState();
  registerTenant(s, TENANT_ID, { firstName: "Web", lastName: "Login" });
  const geo = tenantGeo(s, TENANT_ID);
  assert.equal(geo.country, null, "Vorbedingung: Web-Login setzt kein country");
  assert.equal(geo.defaultLanguage, null, "Vorbedingung: Web-Login setzt kein defaultLanguage");

  const r = requestNumberForPaidTenant(s, {
    tenantId: TENANT_ID,
    fallbackCountry: "DE",
    forceNumberCountry: "US",
    maxNumbers: HIGH,
    maxNumbersPerTenant: HIGH,
  });
  assert.equal(r.ok, true);
  assert.equal(r.number.country, "US", "Kauf-Land ist US (FORCE_NUMBER_COUNTRY)");

  assert.equal(
    r.number.language,
    "en",
    `ein US-Nutzer (Web-Login ohne Geo, US-DID) muss "en" bekommen, ` +
      `nicht das Herkunftsland-Fallback (war "${r.number.language}")`,
  );
});

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
    fallbackCountry: "DE",
    forceNumberCountry: "US",
    maxNumbers: HIGH,
    maxNumbersPerTenant: HIGH,
  });
  r.number.status = "active";
  r.number.e164 = "+12025550188";

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

test("Summary-SMS fuer den US-DID-Tenant enthaelt kein 'Anruf' (ex E2E-04)", async () => {
  const s = makeDefaultState();
  registerTenant(s, TENANT_ID, { firstName: "Web", lastName: "Login" });
  const r = requestNumberForPaidTenant(s, {
    tenantId: TENANT_ID,
    fallbackCountry: "DE",
    forceNumberCountry: "US",
    maxNumbers: HIGH,
    maxNumbersPerTenant: HIGH,
  });

  const smsCapture = [];
  const store = {
    withStoreLock: (fn) => fn(),
    releaseOutboundReserve: async () => {},
    save: () => {},
    addNotification: () => {},
    purgeTranscript: () => {},
    tenantContext: () => ({ settings: { agentName: "Hermes" } }),
    recordUsageEvent: () => {},
    markSummarySmsSent: () => {},
    markBilled: () => {},
    markInboxEntry: () => {},
  };
  const callFinish = makeCallFinish({
    store,
    config: { billing: { paymentEnabled: false, smsCostCents: 0 }, privacy: {} },
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async ({ body }) => smsCapture.push(body) }),
    summarizeCall: async () => ({ summary: "Call summary", actionItems: [] }),
    planSummarySms: () => ({ send: true, to: "+12025550199", smsFrom: { e164: "+12025550188" }, reason: null }),
    audit: () => {},
  });

  const call = seedCall({
    tenantId: TENANT_ID,
    language: r.number.language,
    direction: "outbound",
    status: "completed",
    to: "+12025550199",
    transcript: [{ role: "caller", text: "Hi", at: AT }],
  });
  await callFinish.finishCall(call);

  assert.equal(smsCapture.length, 1);
  assert.doesNotMatch(
    smsCapture[0],
    /Anruf/,
    `SOLL: Summary-SMS eines US-DID-Tenants darf kein 'Anruf' enthalten (war "${smsCapture[0]}")`,
  );
});
