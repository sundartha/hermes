// P5 Gate-Beweis (tasks/telnyx-p5-spec.md, Check 4; PLAN-TELNYX-AI-ASSISTANT.md Regel 1,
// R1-Phase): beweist, dass JEDES der 14 Outbound-Gates (0-13, server.js numberGateError/
// allowlistError/kycGateError/planMinutesExhausted/tryReserveOutboundBudget) auch mit
// aktivem C-Telnyx-Flag + Telnyx-Provider + fakeOriginate blockt - der neue Zweig sitzt
// strukturell HINTER der kompletten, unveraenderten Gate-Kette (KEIN zweiter Einstieg).
// Jede Zeile ist ein minimaler Trip, kopiert/angepasst aus der jeweiligen Seed-Vorlage
// (siehe Kommentar pro Test); reine Fixture-Wiederverwendung, keine Logik-Duplizierung.
// Reiner Spawn (startServer + seedState), KEIN pglite (Lehre p6a-Stall).
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, TELNYX_ASSISTANT_BOOT_ENV } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, USAGE_EVENT_KIND } from "../src/store/defaults.js";
import { findPlan } from "../src/plans.js";

// P10: assertConfig verlangt bei aktivem Flag ASSISTANT_ID/API_KEY/CONNECTION_ID
// (fail-closed Boot) - alle 14 Gate-Tests booten den Server mit FLAG_ON, brauchen die
// drei Werte also NUR damit der Server ueberhaupt startet (FAKE_ORIGINATE macht den
// eigentlichen Origination-Call ohnehin fake, die Werte selbst sind hier bedeutungslos).
const FLAG_ON = {
  FAKE_ORIGINATE: "true",
  TELNYX_AI_ASSISTANT_ENABLED: "true",
  ...TELNYX_ASSISTANT_BOOT_ENV,
};
const TELNYX_OWNER_NUMBER = { e164: "+4915005559001", provider: "telnyx" };
const TO = "+4915112345678"; // normales DE-Ziel, kein Premium/Notruf
const A = "tenant-a",
  SUB_A = "sub-a",
  NUM_A_TELNYX = "+4915005559002";

// ---- Seed-Bausteine (Muster: outbound-frozen/outbound-tenant/kyc-gate-outbound/
// outbound-identity-gate/number-gate/a4-default-profile-zero/outbound-per-target-cap/
// w5-abo-allowlist-gate/outbound-tenant/b2-quota-gate/outbound-reserve-gate.test.js) ----

// Owner-Pfad: BOOTSTRAP_TENANT_ID mit eigener aktiver TELNYX-Nummer. tenantOverrides
// erlaubt gezielte Gate-Trips (z.B. kycLevel), OHNE die Identitaets-Healing der
// ownerName/Number-Seeds zu beruehren (die laueft ueber startServer/ownerNumber separat).
function seedOwnerTelnyx(tenantOverrides = {}) {
  return seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ...tenantOverrides }] });
}

// Tenant-A-Pfad: eigene aktive TELNYX-Nummer, idpSubject, per Default KYC=card +
// ownerName gesetzt + unlimitiertes Profil (passiert alle Gates bis auf das gezielt
// getestete). ownerName/kycLevel null -> Feld ganz weggelassen (Muster
// outbound-identity-gate.test.js seedIdentity), NICHT auf null gesetzt (fail-closed-
// Praedikate lesen "fehlend", nicht "null").
function seedTenantATelnyx({ kycLevel = "card", ownerName = "Alice A", status = "active", profiles, calls = [] } = {}) {
  return seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      {
        id: A,
        status,
        idpSubject: SUB_A,
        ...(ownerName ? { ownerName } : {}),
        ...(kycLevel ? { kycLevel } : {}),
      },
    ],
    numbers: [
      { id: "num_a", e164: NUM_A_TELNYX, tenantId: A, provider: "telnyx", status: "active", providerNumberId: null },
    ],
    profiles: profiles ?? { [A]: { maxCallsPerHour: null } },
    calls,
  });
}

const bucket = (costEur) => ({ inputTokens: 0, outputTokens: 0, costEur, calls: costEur ? 1 : 0 });
const STARTER_MIN = findPlan("starter").includedMinutes;
const fiveDaysAgoSec = Math.floor(Date.now() / 1000) - 5 * 86400;
const voiceMinuteEvent = (tenantId, quantity) => ({
  id: `ue_${tenantId}`,
  tenantId,
  callId: null,
  kind: USAGE_EVENT_KIND.VOICE_MINUTE,
  quantity,
  costCents: 0,
  occurredAt: new Date().toISOString(),
  stripeMeterSent: false,
});

// EIN Spawn-Harness fuer die ganze Tabelle (G5): Flag an ist IMMER gesetzt (FLAG_ON),
// jede Zeile liefert nur die Abweichung (env/seed/ownerNumber/identity/to) + die
// erwartete Deny-Antwort. Origination (weder TeXML noch Call-Control) darf NIE erreicht
// werden -> kein NEUER Call-Record fuer DIESEN Request entsteht. Objective als Marker
// (nicht blosses to-Filtern): manche Zeilen (Gate 7/9) seeden bereits einen VORHANDENEN
// Call auf dasselbe "to" (Fenster-Fueller), der sonst faelschlich mitgezaehlt wuerde.
const REQUEST_OBJECTIVE = "Termin vereinbaren (P5-Gate-Beweis)";
async function placeCallFlagOn({ env = {}, seed, ownerNumber, identity, to = TO, status, grund }) {
  const srv = await startServer({ env: { ...FLAG_ON, ...env }, seed, ownerNumber });
  try {
    const res = await fetch(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(identity ? { "X-Internal-Identity": identity } : {}) },
      body: JSON.stringify({ to, objective: REQUEST_OBJECTIVE }),
    });
    assert.equal(res.status, status, `erwartete Deny-Antwort fuer Gate "${grund}"`);
    const created = srv.readStore().calls.filter((c) => c.goal === REQUEST_OBJECTIVE);
    assert.equal(created.length, 0, `Gate "${grund}": Origination nicht erreicht -> kein Call-Record`);
    return res;
  } finally {
    await srv.stop();
  }
}

// ---- Gate 0: OUTBOUND_FROZEN (Muster outbound-frozen.test.js) ----
test("Gate 0 FROZEN: OUTBOUND_FROZEN=true blockt auch mit Flag an (403)", async () => {
  const res = await placeCallFlagOn({
    env: { OUTBOUND_FROZEN: "true" },
    seed: seedOwnerTelnyx(),
    ownerNumber: TELNYX_OWNER_NUMBER,
    status: 403,
    grund: "frozen",
  });
  assert.match((await res.json()).error, /gesperrt|OUTBOUND_FROZEN/);
});

// ---- Gate 1: TENANT_REJECT (Muster outbound-tenant.test.js #2b) ----
test("Gate 1 TENANT_REJECT: unbekannte Identitaet blockt auch mit Flag an (403)", async () => {
  await placeCallFlagOn({
    env: { MULTI_TENANT: "true" },
    seed: seedOwnerTelnyx(),
    ownerNumber: TELNYX_OWNER_NUMBER,
    identity: "sub-voellig-unbekannt",
    status: 403,
    grund: "tenant_unbekannt",
  });
});

// ---- Gate 2: KYC (Muster kyc-gate-outbound.test.js) ----
test("Gate 2 KYC: kyc_level<card (otp) blockt auch mit Flag an (403)", async () => {
  const res = await placeCallFlagOn({
    seed: seedOwnerTelnyx({ kycLevel: "otp" }),
    ownerNumber: TELNYX_OWNER_NUMBER,
    status: 403,
    grund: "kyc",
  });
  assert.match((await res.json()).error, /KYC/i);
});

// ---- Gate 3: ownerName (Muster outbound-identity-gate.test.js) ----
test("Gate 3 ownerName: fehlender Auftraggeber-Name blockt auch mit Flag an (403)", async () => {
  const res = await placeCallFlagOn({
    env: { MULTI_TENANT: "true" },
    seed: seedTenantATelnyx({ ownerName: null }),
    identity: SUB_A,
    status: 403,
    grund: "keine_identitaet",
  });
  assert.match((await res.json()).error, /Auftraggeber-Name/);
});

// ---- Gate 4: Denylist (Muster number-gate.test.js) ----
test("Gate 4 Denylist: Notruf-Kurzwahl blockt auch mit Flag an (403)", async () => {
  const res = await placeCallFlagOn({
    seed: seedOwnerTelnyx(),
    ownerNumber: TELNYX_OWNER_NUMBER,
    to: "112",
    status: 403,
    grund: "denylist",
  });
  assert.match((await res.json()).error, /is blocked/);
});

// ---- Gate 5: E.164-Format (Muster number-gate.test.js) ----
test("Gate 5 E.164: nicht-E.164-Ziel blockt auch mit Flag an (400)", async () => {
  await placeCallFlagOn({
    seed: seedOwnerTelnyx(),
    ownerNumber: TELNYX_OWNER_NUMBER,
    to: "12345",
    status: 400,
    grund: "format",
  });
});

// ---- Gate 6: Land-Gate (Muster number-gate.test.js) ----
test("Gate 6 Land: Ziel ausserhalb ALLOWED_COUNTRY_CODES blockt auch mit Flag an (403)", async () => {
  const res = await placeCallFlagOn({
    env: { ALLOWED_COUNTRY_CODES: "+49" },
    seed: seedOwnerTelnyx(),
    ownerNumber: TELNYX_OWNER_NUMBER,
    to: "+12025550123",
    status: 403,
    grund: "land",
  });
  assert.match((await res.json()).error, /Country code/);
});

// ---- Gate 7: Stundenlimit pro Tenant (Muster number-gate.test.js) ----
test("Gate 7 Stundenlimit: MAX_CALLS_PER_HOUR erreicht blockt auch mit Flag an (429)", async () => {
  const res = await placeCallFlagOn({
    env: { MAX_CALLS_PER_HOUR: "1" },
    seed: seedState({ calls: [seedCall({ id: "c_recent" })] }), // ownerNumber-Default reicht
    status: 429,
    grund: "stundenlimit",
  });
  assert.match((await res.json()).error, /Hourly limit/);
});

// ---- Gate 8: Profil-Senkung auf 0 (Muster a4-default-profile-zero.test.js) ----
test("Gate 8 Profil-Limit 0: profil-loser Tenant (DEFAULT=0) blockt auch mit Flag an (429)", async () => {
  const res = await placeCallFlagOn({
    env: { MULTI_TENANT: "true" },
    seed: seedTenantATelnyx({ profiles: {} }), // KEIN Profil unter A -> DEFAULT_PROFILE(0)
    identity: SUB_A,
    status: 429,
    grund: "stundenlimit",
  });
  assert.match((await res.json()).error, /Hourly limit/);
});

// ---- Gate 9: Cooldown/per-Target-Cap (Muster outbound-per-target-cap.test.js) ----
test("Gate 9 Cooldown: per-(Tenant,Ziel)-Cap erreicht blockt auch mit Flag an (429)", async () => {
  const res = await placeCallFlagOn({
    env: { MULTI_TENANT: "true", PER_TARGET_CALL_CAP: "1" },
    seed: seedTenantATelnyx({ calls: [seedCall({ id: "c_prior", tenantId: A })] }), // to=TO per Default
    identity: SUB_A,
    status: 429,
    grund: "ziel_limit",
  });
  assert.match((await res.json()).error, /Repeat limit/);
});

// ---- Gate 10: Verifikation/Allowlist (Muster w5-abo-allowlist-gate.test.js W5-3) ----
test("Gate 10 Verifikation: suspendierter Tenant blockt auch mit Flag an (403, Defense-in-depth)", async () => {
  const res = await placeCallFlagOn({
    env: { MULTI_TENANT: "true" },
    seed: seedTenantATelnyx({ status: "suspended" }),
    identity: SUB_A,
    status: 403,
    grund: "abo",
  });
  assert.match((await res.json()).error, /Subscription inactive|blocked/i);
});

// ---- Gate 11: Budget (Muster outbound-tenant.test.js #3) ----
test("Gate 11 Budget: erschoepftes Tenant-Budget blockt auch mit Flag an (402)", async () => {
  const seed = seedTenantATelnyx();
  seed.usage = { [BOOTSTRAP_TENANT_ID]: bucket(0), [A]: bucket(99) }; // 99 >= MAX_BUDGET_EUR(30, LCT P6)
  const res = await placeCallFlagOn({
    env: { MULTI_TENANT: "true" },
    seed,
    identity: SUB_A,
    status: 402,
    grund: "budget",
  });
  assert.match((await res.json()).error, /budget limit/);
});

// ---- Gate 12: Minuten-Kontingent (Muster b2-quota-gate.test.js) ----
test("Gate 12 Minuten: erschoepftes Plan-Kontingent blockt auch mit Flag an (402)", async () => {
  // Abo-Anker (Periodenstart vor 5 Tagen) + Voice-Minuten-Ledger >= includedMinutes ->
  // planMinutesExceeded. seedTenantATelnyx deckt nur die Gate-0-10-Felder ab; Abo-Anker/
  // Ledger sind eigene Achsen -> nachtraeglich auf dem Seed-Ergebnis gesetzt (Muster
  // usage in Gate 11 oben, usageEvents wie b2-quota-gate.test.js).
  const seed = seedTenantATelnyx();
  const tenantA = seed.tenants.find((t) => t.id === A);
  tenantA.stripePlanSlug = "starter";
  tenantA.stripeCurrentPeriodStart = fiveDaysAgoSec;
  seed.usageEvents = [voiceMinuteEvent(A, STARTER_MIN)];
  const res = await placeCallFlagOn({
    env: {
      MULTI_TENANT: "true",
      PAYMENT_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_x",
      STRIPE_WEBHOOK_SECRET: "whsec_test_x",
      STRIPE_API_BASE: "http://127.0.0.1:9",
      NUMBER_SETUP_FEE_CENTS: "500",
    },
    seed,
    identity: SUB_A,
    status: 402,
    grund: "minutes",
  });
  assert.match((await res.json()).error, /Plan-Minuten/);
});

// ---- Gate 13: Reserve (Muster outbound-reserve-gate.test.js) ----
test("Gate 13 Reserve: Worst-Case-Reserve > Cap blockt auch mit Flag an (402)", async () => {
  // MAX_BUDGET_EUR wirkt hier als Pro-Tenant-Fallback (effectiveCapCents Stufe 3 - der Owner
  // hat keine tenant_budget-Zeile). KS-P3 (a): die Reserve ist Satz * RESERVE_LEAD_MINUTES
  // (2), nicht mehr Satz * angefangene Minuten der Maximaldauer - die Zahlen werden neu
  // gewaehlt, die Aussage bleibt dieselbe. 5 EUR = 500 ct Cap;
  // Worst-Case-Tarif 400 ct/min x 2 Vorlauf-Minuten = 800 ct > 500 ct.
  const res = await placeCallFlagOn({
    env: { MAX_BUDGET_EUR: "5", VOICE_TARIFF_DEFAULT_CENTS: "400" },
    seed: seedOwnerTelnyx(),
    ownerNumber: TELNYX_OWNER_NUMBER,
    to: "+12025550123", // US -> Worst-Case-Default-Tarif (teuer)
    status: 402,
    grund: "reserve_ueber_rest",
  });
  assert.match((await res.json()).error, /\d+\.\d{2} EUR short/);
});
