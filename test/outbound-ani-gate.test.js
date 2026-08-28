// OUTBOUND-E4 (F4): der ANI-Riegel (src/telephony/outbound-gates.js#ani_ownership) - das
// EINZIGE Gate dieser Etappe. Muster test/outbound-gates-order.test.js/deny-
// diagnosability.test.js: makeOutboundGates(deps) + gate.run(ctx) DIREKT, offline, kein
// Spawn, kein Netz, keine DB - dieselbe Bauform, die outbound-gates.js FUER ALLE seine
// bisherigen Gates verwendet (kein einziges bestehendes Gate hier hat einen Spawn-Test).
//
// DEVIATION (dokumentiert, s. Report): der Plan nennt "Spawn-Test" als Muster. Ein echter
// Server-Spawn koennte aniOwnershipRecheck nicht deterministisch ueberschreiben, ohne eine
// neue Netz-Mocking-Naht einzufuehren, die es in diesem Repo nicht gibt (keine Mocking-
// Library, keine bestehende Server-Injektionsstelle fuer eine einzelne Gate-Dependency).
// Die in-process-Pruefung deckt exakt dieselbe Kette (dieselbe Fabrik, derselbe
// gate.run(ctx)-Aufruf), die server.js zur Laufzeit verwendet - der Server-Wiring-Teil
// (server.js baut den echten aniOwnershipRecheck ueber providerConfigRead()) ist separat
// per Quelltext-Grep in test/ausfall-server-wiring.test.js gedeckt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOutboundGates } from "../src/telephony/outbound-gates.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const VALID_TO = "+491711234567";
const FRISCH_ISO = "2026-08-27T16:45:00.000Z";
const FRISCH_MS = Date.parse(FRISCH_ISO);
const MAX_AGE_MS = 900000; // 15 min, Produktions-Default
const EINE_MINUTE_MS = 60000; // Abstand "jetzt" zur Fixture-Zeit, klar innerhalb jeder Frist
const HTTP_SERVICE_UNAVAILABLE = 503;

// Vollstaendig durchgesteuerter Default-Store (Muster outbound-gates-order.test.js): die
// GESAMTE Kette laesst sich bis reserve_budget durchfahren, ohne dass ein anderes Gate
// ablehnt - G-2 braucht das, um zu belegen, dass NACH dem ani_ownership-Deny kein
// spaeteres Gate (insbesondere reserve_budget/tryReserveOutboundBudget) je erreicht wird.
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

// Faehrt die GESAMTE Kette bis zur ERSTEN Ablehnung (oder bis zum Ende) - exakt das
// Verhalten der realen Server-Loop (routes/api-calls.js), nur ohne HTTP/Express drumherum.
async function fahreKette(gates, to = VALID_TO) {
  // ctx ist EIN mutables Objekt (Vertrag der Gate-Kette, s. outbound-gates.js-Modul-Doc):
  // jedes Gate darf ctx ANREICHERN (z.B. resolve_outbound setzt ctx.fromNumber) - keine
  // Kopie zwischen den Aufrufen, genau wie in der realen Server-Loop.
  const ctx = { to, objective: "Ziel", "b": { briefing: "Kontext" } };
  for (const gate of gates) {
    const ergebnis = await gate.run(ctx);
    if (ergebnis) return { denial: ergebnis, gate: gate.name };
  }
  return { denial: null, gate: null };
}

const echterDateNow = Date.now;
// WICHTIG: async + await vor fn() - fahreKette ist eine async Funktion, deren
// Iterationen ueber "await gate.run(ctx)" microtask-verzoegert weiterlaufen. Ein
// synchrones try/finally wuerde Date.now schon restaurieren, BEVOR die eigentlichen
// Gate-Aufrufe (insbesondere die Frische-Pruefung in ani_ownership) je laufen - der Test
// wuerde dann gegen die ECHTE Systemzeit pruefen statt gegen die Fixture-Zeit.
async function mitUhr(ms, fn) {
  Date.now = () => ms;
  try {
    return await fn();
  } finally {
    Date.now = echterDateNow;
  }
}

// G-1: Beobachtungsmodus -------------------------------------------------------------
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

// G-2: scharf + frisch + Nachmessung bestaetigt --------------------------------------
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

// G-3: unbekannt ODER zu alt -> durchlassen (fail-open bei Unwissen) -----------------
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
  // GENAU eine Millisekunde ueber der Frist - fail-open bei Unwissen ueber ein fast
  // stundenaltes Ergebnis (plan:free steht der Prozess still).
  const { denial } = await mitUhr(FRISCH_MS + MAX_AGE_MS + 1, () => fahreKette(gates));
  assert.equal(denial, null);
});

// G-4: Nachmessung schlaegt fehl -> durchlassen --------------------------------------
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
  // Fail-open ist eine Eigenschaft DES GATES (nicht nur der server.js-Wiring-Disziplin):
  // ein werfender Recheck darf den Request nie mit einem unbehandelten 500 abbrechen.
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

// G-5: OUTBOUND_FROZEN bleibt in ALLEN Faellen unveraendert (Regressionsschutz) ------
test("E4-ANI-Riegel: G-5 in allen Faellen bleibt config.safety.outboundFrozen unveraendert (kein Selbstabschalter)", async () => {
  const config = defaultConfig({ outboundAniGateEnabled: true, outboundFrozen: false });
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
  await mitUhr(FRISCH_MS + EINE_MINUTE_MS, () => fahreKette(gates));
  assert.equal(config.safety.outboundFrozen, false, "der ANI-Riegel schreibt OUTBOUND_FROZEN NIE");
});
