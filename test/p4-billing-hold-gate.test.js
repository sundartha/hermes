// P4 GAP-03/O2: das neue billing_hold-Gate in outbound-gates.js (allowlistError, direkt
// nach dem tenantInactive-Riegel). Offline, Muster test/outbound-gates-order.test.js:
// makeOutboundGates(deps), einzelne gate.run(ctx). Nur der "number_gate"-Eintrag ruft
// allowlistError (letztes Glied in numberGateError).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOutboundGates } from "../src/telephony/outbound-gates.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const VALID_TO = "+491711234567";

function defaultStore(overrides = {}) {
  return {
    // P15/T2: die Gate-Kette liest die Anzeigesprache der Ablehnung aus dem Store. Dieser
    // Test prueft nur die sprachfreie Achse (grund/status) - die Sprache wird trotzdem
    // explizit gesetzt, damit der Fake die reale Kontraktflaeche spiegelt.
    tenantLanguage: () => "de",
    countOutboundCallsSince: () => 0,
    tenantPrivateNumber: () => null,
    load: () => ({
      numbers: [{ tenantId: "T", status: "active", provider: "twilio", e164: "+491700000000" }],
    }),
    kycReached: () => true,
    tenantContext: () => ({ ownerName: "Alice" }),
    resolveProfile: () => ({
      unrestricted: true,
      allowedCountryCodes: null,
      maxCallsPerHour: null,
      allowedNumbers: [],
    }),
    tenantInactive: () => false,
    billingHoldActive: () => null,
    tenantActiveSubscriber: () => true,
    tenantSubscription: () => ({}),
    planMinutesExceeded: () => false,
    budgetExceeded: () => false,
    globalBudgetExceeded: () => false,
    withStoreLock: (fn) => fn(),
    tryReserveOutboundBudget: () => true,
    tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 350, remainingCents: 650 }),
    reserveExceedsBudget: () => true,
    claimPlatformSpendWarning: () => null,
    ...overrides,
  };
}

function defaultConfig() {
  return {
    outboundFrozen: false,
    assistantContextEnabled: false,
    paymentEnabled: false,
    platformSpendCapCents: 800,
    allowedCountryCodes: ["+49"],
    maxCallsPerHour: 100,
    perTargetWindowMs: 3600000,
    perTargetCallCap: 100,
    maxCallDurationS: 180,
  };
}

function makeDeps(o = {}) {
  return {
    store: defaultStore(o.store),
    config: withConfigNamespaces({ ...defaultConfig(), ...o.config }),
    requestTenant: () => "T",
    internalIdentity: () => null,
    OWNER_ID: "owner",
    TENANT_REJECT: "reject",
  };
}

const gateBy = (gates, name) => gates.find((g) => g.name === name);

function baseCtx(overrides = {}) {
  return {
    req: {},
    to: VALID_TO,
    requestedBy: "owner",
    tenantId: "T",
    profile: { unrestricted: true, allowedCountryCodes: null, maxCallsPerHour: null, allowedNumbers: [] },
    ...overrides,
  };
}

test("billingHoldActive='paused' -> 403 grund=billing_hold", async () => {
  const { gates } = makeOutboundGates(makeDeps({ store: { billingHoldActive: () => "paused" } }));
  const denial = await gateBy(gates, "number_gate").run(baseCtx());
  assert.equal(denial.status, 403);
  assert.equal(denial.audit.grund, "billing_hold");
});

test("Frist noch offen (billingHoldActive liest null zurueck) -> KEIN Block", async () => {
  const { gates } = makeOutboundGates(makeDeps({ store: { billingHoldActive: () => null } }));
  const denial = await gateBy(gates, "number_gate").run(baseCtx());
  assert.equal(denial, null, "kein Denial - Frist noch nicht abgelaufen");
});

test("Frist abgelaufen (billingHoldActive liest 'payment_action' zurueck) -> Block", async () => {
  const { gates } = makeOutboundGates(makeDeps({ store: { billingHoldActive: () => "payment_action" } }));
  const denial = await gateBy(gates, "number_gate").run(baseCtx());
  assert.equal(denial.status, 403);
  assert.equal(denial.audit.grund, "billing_hold");
});

test("ein gesetzter Hold hebt KEIN vorgelagertes Gate auf (Denylist bleibt vor number_gate)", async () => {
  const { gates } = makeOutboundGates(makeDeps({ store: { billingHoldActive: () => "paused" } }));
  const denylistDenial = await gateBy(gates, "number_gate").run(baseCtx({ to: "112" }));
  assert.equal(denylistDenial.audit.grund, "denylist", "Denylist-Praezedenz bleibt unveraendert");
});

test("Inbound-Pfad unberuehrt: billingHoldActive wird NUR vom Outbound-Gate gelesen (keine Kopplung)", async () => {
  let reads = 0;
  const { gates } = makeOutboundGates(
    makeDeps({ store: { billingHoldActive: () => (reads++, null) } }),
  );
  await gateBy(gates, "number_gate").run(baseCtx());
  assert.equal(reads, 1, "genau ein Lesevorgang fuer diesen Outbound-Versuch");
});
