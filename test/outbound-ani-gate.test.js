import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOutboundGates } from "../src/telephony/outbound-gates.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const VALID_TO = "+491711234567";
const FRISCH_ISO = "2026-08-27T16:45:00.000Z";
const FRISCH_MS = Date.parse(FRISCH_ISO);
const MAX_AGE_MS = 900000;
const EINE_MINUTE_MS = 60000;
const HTTP_SERVICE_UNAVAILABLE = 503;
const PLATTFORM_ANI = "+18643028341";
const TENANT_DID = "+491700000000";

function defaultStore(overrides = {}) {
  return {
    tenantLanguage: () => "de",
    countOutboundCallsSince: () => 0,
    tenantPrivateNumber: () => null,
    tenantGeo: () => ({ country: "DE" }),
    load: () => ({
      numbers: [{ tenantId: "T", status: "active", provider: "telnyx", e164: "+491700000000" }],
      outageAlerts: [],
    }),
    kycReached: () => true,
    tenantContext: () => ({ ownerName: "Alice" }),
    resolveProfile: () => ({ unrestricted: true, allowedCountryCodes: null, maxCallsPerHour: null, allowedNumbers: [] }),
    tenantInactive: () => false,
    billingHoldActive: () => null,
    tenantActiveSubscriber: () => true,
    tenantSubscription: () => ({}),
    planMinutesExceeded: () => false,
    budgetExceeded: () => false,
    withStoreLock: (fn) => fn(),
    tryReserveOutboundBudget: () => true,
    reserveExceedsBudget: () => false,
    tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 0, remainingCents: 1000 }),
    claimPlatformSpendWarning: () => null,
    ...overrides,
  };
}

function defaultConfig(overrides = {}) {
  return withConfigNamespaces({
    outboundFrozen: false,
    allowedCountryCodes: ["+49", "+33", "+44"],
    maxCallsPerHour: 100,
    perTargetCallCap: 100,
    perTargetWindowMs: 86400000,
    outboundAniGateEnabled: false,
    outboundAniGateMaxAgeMs: MAX_AGE_MS,
    platformAniE164: PLATTFORM_ANI,
    ...overrides,
  });
}

function makeDeps(overrides = {}) {
  return {
    store: defaultStore(overrides.store),
    config: defaultConfig(overrides.config),
    requestTenant: () => "T",
    internalIdentity: () => null,
    OWNER_ID: "owner",
    TENANT_REJECT: "reject",
    audit: () => {},
    messaging: () => ({ sendSms: async () => {} }),
    ...(overrides.aniOwnershipRecheck ? { aniOwnershipRecheck: overrides.aniOwnershipRecheck } : {}),
  };
}

async function fahreKette(gates, to = VALID_TO) {
  const ctx = { to, objective: "Ziel", "b": { briefing: "Kontext" } };
  for (const gate of gates) {
    const ergebnis = await gate.run(ctx);
    if (ergebnis) return { denial: ergebnis, gate: gate.name };
  }
  return { denial: null, gate: null };
}

const echterDateNow = Date.now;
async function mitUhr(ms, fn) {
  Date.now = () => ms;
  try {
    return await fn();
  } finally {
    Date.now = echterDateNow;
  }
}

test("E4-ANI-Riegel: G-1 OUTBOUND_ANI_GATE_ENABLED=false + offener ownership_lost -> place_call laeuft unveraendert durch", async () => {
  let reserviert = 0;
  const { gates } = makeOutboundGates(
    makeDeps({
      config: { outboundAniGateEnabled: false },
      store: {
        load: () => ({
          numbers: [{ tenantId: "T", status: "active", provider: "telnyx", e164: "+491700000000" }],
          outageAlerts: [{ code: "drift:ownership_lost", closedAt: null, lastSeenAt: FRISCH_ISO }],
        }),
        tryReserveOutboundBudget: () => {
          reserviert += 1;
          return true;
        },
      },
      aniOwnershipRecheck: async () => true,
    }),
  );
  const { denial } = await mitUhr(FRISCH_MS + EINE_MINUTE_MS, () => fahreKette(gates));
  assert.equal(denial, null, "Beobachtungsmodus: kein Deny");
  assert.equal(reserviert, 1, "die Kette laeuft bis reserve_budget durch");
});

test("E4-ANI-Riegel: G-2 enabled=true + frischer ownership_lost + Nachmessung bestaetigt -> 503, denialAudit ani_not_owned, 0 Waehlversuche", async () => {
  let reserviert = 0;
  let nachmessungAufrufe = 0;
  const { gates } = makeOutboundGates(
    makeDeps({
      config: { outboundAniGateEnabled: true },
      store: {
        load: () => ({
          numbers: [{ tenantId: "T", status: "active", provider: "telnyx", e164: "+491700000000" }],
          outageAlerts: [{ code: "drift:ownership_lost", closedAt: null, lastSeenAt: FRISCH_ISO }],
        }),
        tryReserveOutboundBudget: () => {
          reserviert += 1;
          return true;
        },
      },
      aniOwnershipRecheck: async () => {
        nachmessungAufrufe += 1;
        return true;
      },
    }),
  );
  const { denial, gate } = await mitUhr(FRISCH_MS + EINE_MINUTE_MS, () => fahreKette(gates));
  assert.ok(denial, "muss ablehnen");
  assert.equal(gate, "ani_ownership");
  assert.equal(denial.status, HTTP_SERVICE_UNAVAILABLE);
  assert.equal(denial.audit.grund, "ani_not_owned");
  assert.equal(denial.audit.event, "place_call_denied");
  assert.equal(nachmessungAufrufe, 1, "genau EINE Live-Nachmessung");
  assert.equal(reserviert, 0, "0 Waehlversuche - reserve_budget wurde NIE erreicht");
});

test("E4-ANI-Riegel: G-2b die Live-Nachmessung erhaelt BYTE-GENAU die Plattform-ANI, NICHT die Tenant-DID (ctx.fromNumber)", async () => {
  let gemesseneE164 = null;
  const { gates } = makeOutboundGates(
    makeDeps({
      config: { outboundAniGateEnabled: true, platformAniE164: PLATTFORM_ANI },
      store: {
        load: () => ({
          numbers: [{ tenantId: "T", status: "active", provider: "telnyx", e164: TENANT_DID }],
          outageAlerts: [{ code: "drift:ownership_lost", closedAt: null, lastSeenAt: FRISCH_ISO }],
        }),
      },
      aniOwnershipRecheck: async (e164) => {
        gemesseneE164 = e164;
        return true;
      },
    }),
  );
  await mitUhr(FRISCH_MS + EINE_MINUTE_MS, () => fahreKette(gates));
  assert.equal(gemesseneE164, PLATTFORM_ANI, "die Nachmessung muss die PLATTFORM-ANI bekommen");
  assert.notEqual(
    gemesseneE164,
    TENANT_DID,
    "die Nachmessung darf NIEMALS die Absender-DID des anrufenden Tenants bekommen (Blocker 2)",
  );
});

test("E4-ANI-Riegel: G-3a enabled=true + KEINE Messung -> durchlassen", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({ config: { outboundAniGateEnabled: true }, aniOwnershipRecheck: async () => true }),
  );
  const { denial } = await mitUhr(FRISCH_MS, () => fahreKette(gates));
  assert.equal(denial, null);
});

test("E4-ANI-Riegel: G-3b enabled=true + Messung AELTER als OUTBOUND_ANI_GATE_MAX_AGE_MS -> durchlassen", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      config: { outboundAniGateEnabled: true },
      store: {
        load: () => ({
          numbers: [{ tenantId: "T", status: "active", provider: "telnyx", e164: "+491700000000" }],
          outageAlerts: [{ code: "drift:ownership_lost", closedAt: null, lastSeenAt: FRISCH_ISO }],
        }),
      },
      aniOwnershipRecheck: async () => true,
    }),
  );
  const { denial } = await mitUhr(FRISCH_MS + MAX_AGE_MS + 1, () => fahreKette(gates));
  assert.equal(denial, null);
});

test("E4-ANI-Riegel: G-4 enabled=true + Messung negativ, Live-Nachmessung WIRFT (Timeout/Netzfehler) -> durchlassen, kein 500", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      config: { outboundAniGateEnabled: true },
      store: {
        load: () => ({
          numbers: [{ tenantId: "T", status: "active", provider: "telnyx", e164: "+491700000000" }],
          outageAlerts: [{ code: "drift:ownership_lost", closedAt: null, lastSeenAt: FRISCH_ISO }],
        }),
      },
      aniOwnershipRecheck: async () => {
        throw new Error("timeout");
      },
    }),
  );
  const { denial } = await mitUhr(FRISCH_MS + EINE_MINUTE_MS, () => fahreKette(gates));
  assert.equal(denial, null, "ein werfender Recheck laesst durch, statt den Request zu crashen");
});

test("E4-ANI-Riegel: G-4b enabled=true + Messung negativ, Nachmessung liefert null (unbestimmt) -> durchlassen", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      config: { outboundAniGateEnabled: true },
      store: {
        load: () => ({
          numbers: [{ tenantId: "T", status: "active", provider: "telnyx", e164: "+491700000000" }],
          outageAlerts: [{ code: "drift:ownership_lost", closedAt: null, lastSeenAt: FRISCH_ISO }],
        }),
      },
      aniOwnershipRecheck: async () => null,
    }),
  );
  const { denial } = await mitUhr(FRISCH_MS + EINE_MINUTE_MS, () => fahreKette(gates));
  assert.equal(denial, null, "fail-open: null aus der Nachmessung heisst durchlassen");
});

test("E4-ANI-Riegel: G-5 in allen Faellen bleibt config.safety.outboundFrozen unveraendert (kein Selbstabschalter)", async () => {
  const deps = makeDeps({
    config: { outboundAniGateEnabled: true },
    store: {
      load: () => ({
        numbers: [{ tenantId: "T", status: "active", provider: "telnyx", e164: "+491700000000" }],
        outageAlerts: [{ code: "drift:ownership_lost", closedAt: null, lastSeenAt: FRISCH_ISO }],
      }),
    },
    aniOwnershipRecheck: async () => true,
  });
  const { gates } = makeOutboundGates(deps);
  await mitUhr(FRISCH_MS + EINE_MINUTE_MS, () => fahreKette(gates));
  assert.equal(deps.config.safety.outboundFrozen, false, "der ANI-Riegel schreibt OUTBOUND_FROZEN NIE");
});

test("E4-ANI-Riegel: G-5b Gegenprobe - ein absichtliches Schreiben auf deps.config.safety.outboundFrozen macht die G-5-Assertion rot", async () => {
  const deps = makeDeps({ config: { outboundAniGateEnabled: true } });
  const { gates } = makeOutboundGates(deps);
  await mitUhr(FRISCH_MS, () => fahreKette(gates));
  deps.config.safety.outboundFrozen = true;
  assert.throws(
    () => assert.equal(deps.config.safety.outboundFrozen, false),
    "eine Sabotage auf DEMSELBEN Objekt, das G-5 prueft, muss die Assertion zum Scheitern bringen",
  );
});
