// E2E-04 (i18n-Testkatalog, tasks/i18n-tests/11-luecken-und-e2e.md:943) - Bestandstenant
// ohne country/language durch die volle Kette.
//
// SOLL: die Kette soll fuer einen US-Nutzer ein durchgehend englisches Produkt liefern.
// P10 (PLAN-I18N-FIX) loest NUR Teil 1 (number.language) - die Aufloesung, worauf die
// Sprache zeigt. Teil 2 (Inbound-Greeting) und Teil 3 (Summary-SMS) sind eigene Wurzeln
// (settings.greeting folgt der Sprache strukturell nicht, PROMPT-03/WEB-04/WEB-14) und
// bleiben bis P11 rot - P10 aendert bewusst NICHT, OB das Greeting der Sprache folgt.
// Vorbedingung ist ein Tenant, der genau den Zustand des REALEN Web-Login-Pfads
// traegt (country=null, defaultLanguage=null) - LANG-02 (test/web-login-wiring.test.js)
// beweist bereits empirisch gegen die echte DB, dass POST /auth/dev-login exakt diesen
// Zustand erzeugt (resolveOrCreateTenant, src/web-auth.js:503-518, schreibt nur id/status/
// idp_subject). Dieser Test baut den GLEICHEN Zustand direkt ueber registerTenant (ohne
// setTenantGeo) auf makeDefaultState() nach - selbes Ergebnis, ohne pglite-in-Kindprozess
// zu mischen (Lehre p6a-Stall, s. Kommentarkopf test/web-login-wiring.test.js) - und faehrt
// dann Nummernkauf (requestNumberForPaidTenant, PURE, Muster test/bk3-auto-provision.test.js)
// + Inbound-Call + Summary-SMS durch dieselbe reale Kette wie ein Server-Spawn.
//
// Beleg fuer den Kern-Defekt: homeCountry = tenantGeo(...).country || fallbackCountry
// (src/billing/provision-trigger.js:33) faellt OHNE Tenant-Geo auf fallbackCountry="DE"
// zurueck (render.yaml PROVISIONING_COUNTRY), waehrend forceNumberCountry="US"
// (render.yaml FORCE_NUMBER_COUNTRY) nur das KAUF-Land aendert - Ergebnis: US-DID mit
// language="de".
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
  // Schritt 1: Tenant exakt wie der reale Web-Login-Pfad - KEIN setTenantGeo-Aufruf.
  registerTenant(s, TENANT_ID, { firstName: "Web", lastName: "Login" });
  const geo = tenantGeo(s, TENANT_ID);
  assert.equal(geo.country, null, "Vorbedingung: Web-Login setzt kein country");
  assert.equal(geo.defaultLanguage, null, "Vorbedingung: Web-Login setzt kein defaultLanguage");

  // Schritt 2: Abo-Webhook -> Nummernkauf (PURE, wie render.yaml es fuer JEDEN Tenant faehrt).
  const r = requestNumberForPaidTenant(s, {
    tenantId: TENANT_ID,
    fallbackCountry: "DE", // render.yaml PROVISIONING_COUNTRY
    forceNumberCountry: "US", // render.yaml FORCE_NUMBER_COUNTRY
    maxNumbers: HIGH,
    maxNumbersPerTenant: HIGH,
  });
  assert.equal(r.ok, true);
  assert.equal(r.number.country, "US", "Kauf-Land ist US (FORCE_NUMBER_COUNTRY)");

  // Ein Tenant ohne eigene Geo bekommt den Weltdefault, NICHT die Sprache des Landes,
  // in dem die Plattform fuer ihn zufaellig einkauft (Achsentrennung, P10 Schritt 1).
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
  // Dry-Run-Nummer 'requested' -> fuer den Inbound-Routing-Test aktivieren + eine
  // plausible US-E.164 vergeben (der reale Kauf laeuft ueber den Provisioning-Worker,
  // hier interessiert nur das Routing-Ergebnis).
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
    // INBOX-P1: der Marker faellt am Gespraechsende immer (No-op bei false).
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
    // r.number.language ist der reale, heute gemessene Wert dieser Kette (nicht
    // hartkodiert "de") - der Test bleibt korrekt, sobald der Fix landet.
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
