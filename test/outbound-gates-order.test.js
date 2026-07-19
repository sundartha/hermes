// P6 (Struct-1) - Snapshot- und Verhaltenstest fuer die extrahierte Outbound-Gate-Kette
// (src/telephony/outbound-gates.js). Reine Mock-Tabellentests nach dem Muster
// test/request-tenant-unit.test.js: offline, kein Spawn, keine DB, kein Netz. Ruft
// makeOutboundGates(deps) und die EINZELNEN gate.run(ctx) direkt auf (nicht die
// Server-Loop in server.js) - jedes Gate ist damit isoliert beweisbar.
//
// EXPECTED_ORDER ist bewusst NICHT aus dem Modul reexportiert, sondern hier hartkodiert:
// eine kuenftige Umsortierung der Gate-Kette soll DIESEN Test bewusst brechen, statt
// trivial gruen zu bleiben (G31/G27 - die Reihenfolge ist eine erzwungene Struktur, kein
// Kommentar).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOutboundGates } from "../src/telephony/outbound-gates.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const EXPECTED_ORDER = [
  "outbound_frozen",
  "resolve_identity",
  "tenant_reject",
  "normalize_target",
  "trunk_zero_normalized",
  "kyc",
  "owner_name",
  "resolve_profile",
  "number_gate",
  "valid_text",
  "valid_mandate",
  "assistant_context",
  "resolve_outbound",
  "budget",
  "minutes",
  "compute_reserve",
  "reserve_budget",
];

const VALID_TO = "+491711234567";

// Vollstaendig durchgesteuerter Default-Store: JEDES Gate laesst sich mit diesen Werten
// isoliert aufrufen, ohne Vorbedingung zu verletzen (alle Praedikate "erlauben"). Tests
// ueberschreiben NUR die Methode(n), die das jeweils gepruefte Gate ablehnen lassen soll
// (P13 Build-Operate-Check: Setup-Boilerplate hinter diesem Helper versteckt).
function defaultStore() {
  return {
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
    tenantActiveSubscriber: () => true,
    tenantSubscription: () => ({}),
    planMinutesExceeded: () => false,
    budgetExceeded: () => false,
    globalBudgetExceeded: () => false,
    withStoreLock: (fn) => fn(),
    tryReserveOutboundBudget: () => true,
  };
}

function defaultConfig() {
  return {
    outboundFrozen: false,
    assistantContextEnabled: false,
    paymentEnabled: false,
    maxBudgetCents: 800,
    allowedCountryCodes: ["+49"],
    maxCallsPerHour: 100,
    perTargetWindowMs: 3600000,
    perTargetCallCap: 100,
    maxCallDurationS: 180,
  };
}

function makeDeps(o = {}) {
  return {
    store: { ...defaultStore(), ...o.store },
    config: withConfigNamespaces({ ...defaultConfig(), ...o.config }),
    requestTenant: o.requestTenant ?? (() => "T"),
    internalIdentity: o.internalIdentity ?? (() => null),
    OWNER_ID: "owner",
    TENANT_REJECT: "reject",
  };
}

const gateBy = (gates, name) => gates.find((g) => g.name === name);

// Vollstaendig vorbefuellter ctx, wie ihn der Server-Loop nach den Vorgaenger-Gates
// haette (F1: haelt die einzelnen Tests auf EIN geaendertes Feld reduziert).
function baseCtx(overrides = {}) {
  return {
    req: {},
    to: VALID_TO,
    objective: "Termin vereinbaren",
    b: {},
    requestedBy: "owner",
    tenantId: "T",
    profile: {
      unrestricted: true,
      allowedCountryCodes: null,
      maxCallsPerHour: null,
      allowedNumbers: [],
    },
    ...overrides,
  };
}

// === (a) Order-Snapshot ==========================================================

test("Gate-Reihenfolge ist der eingefrorene Snapshot", () => {
  const { gates } = makeOutboundGates(makeDeps());
  assert.deepEqual(
    gates.map((g) => g.name),
    EXPECTED_ORDER,
  );
});

// === (b) Je Gate ein Ablehnungsfall ==============================================

test("outbound_frozen: config.outboundFrozen -> 403 grund=frozen, kein requestedBy, Kurzschluss VOR resolve_identity", async () => {
  let requestTenantCalls = 0;
  const deps = makeDeps({
    config: { outboundFrozen: true },
    requestTenant: () => {
      requestTenantCalls++;
      return "T";
    },
  });
  const { gates } = makeOutboundGates(deps);
  const ctx = baseCtx();
  // Die Server-Loop bricht am ersten Denial ab - hier nachgebaut, um den Kurzschluss
  // (kein Aufruf von requestTenant) zu beweisen.
  let denial = null;
  for (const gate of gates) {
    denial = await gate.run(ctx);
    if (denial) break;
  }
  assert.equal(denial.status, 403);
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=frozen`);
  assert.equal(requestTenantCalls, 0, "outbound_frozen feuert VOR resolve_identity");
});

test("tenant_reject: unbekannte Identitaet -> 403 grund=tenant_unbekannt requestedBy=...", async () => {
  const { gates } = makeOutboundGates(makeDeps());
  const denial = await gateBy(gates, "tenant_reject").run(
    baseCtx({ tenantId: "reject", requestedBy: "alice" }),
  );
  assert.equal(denial.status, 403);
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=tenant_unbekannt requestedBy=alice`);
});

test("trunk_zero_normalized: Trunk-0 nach Laendervorwahl im normalisierten to -> 400, audit null", async () => {
  const { gates } = makeOutboundGates(makeDeps());
  const ctx = baseCtx({ to: "+4901737123456" });
  const denial = await gateBy(gates, "trunk_zero_normalized").run(ctx);
  assert.equal(denial.status, 400);
  assert.equal(denial.audit, null);
});

test("kyc: store.kycReached=false -> 403 grund=kyc tenant=... requestedBy=...", async () => {
  const { gates } = makeOutboundGates(makeDeps({ store: { kycReached: () => false } }));
  const denial = await gateBy(gates, "kyc").run(baseCtx());
  assert.equal(denial.status, 403);
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=kyc tenant=T requestedBy=owner`);
});

test("owner_name: kein registrierter Auftraggeber-Name -> 403 grund=keine_identitaet", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({ store: { tenantContext: () => ({ ownerName: "" }) } }),
  );
  const denial = await gateBy(gates, "owner_name").run(baseCtx());
  assert.equal(denial.status, 403);
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=keine_identitaet tenant=T requestedBy=owner`);
});

test("number_gate: ungueltiges E.164-Format -> 400, audit null (Sonderfall)", async () => {
  const { gates } = makeOutboundGates(makeDeps());
  const ctx = baseCtx({ to: "keine-nummer" });
  const denial = await gateBy(gates, "number_gate").run(ctx);
  assert.equal(denial.status, 400);
  assert.equal(denial.audit, null);
});

test("number_gate: Denylist (Satelliten-Prefix) -> 403 grund=denylist requestedBy=..., kein tenant", async () => {
  const { gates } = makeOutboundGates(makeDeps());
  const ctx = baseCtx({ to: "+870123456789" });
  const denial = await gateBy(gates, "number_gate").run(ctx);
  assert.equal(denial.status, 403);
  assert.equal(denial.audit.detail, `to=${ctx.to} grund=denylist requestedBy=owner`);
  assert.ok(!denial.audit.detail.includes("tenant="));
});

// PA-15 (PM-10-Guard): Wert-Tests der migrierten Gate-Werte (config.safety.*). Fangen den
// "falscher-aber-existierender-Blattname"-Fall (z.B. maxCallsPerHour <-> perTargetCallCap
// vertauscht), den weder der grep-Gate noch der guardedConfig-Proxy fangen wuerden.
test("number_gate: LAND-Gate (config.safety.allowedCountryCodes) -> 403 grund=land", async () => {
  const { gates } = makeOutboundGates(makeDeps());
  const ctx = baseCtx({ to: "+15551234567" });
  const denial = await gateBy(gates, "number_gate").run(ctx);
  assert.equal(denial.status, 403);
  assert.match(denial.audit.detail, /grund=land/);
});

test("number_gate: STUNDENLIMIT (config.safety.maxCallsPerHour) -> 429, Meldung nennt den Blattwert", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      config: { maxCallsPerHour: 5 },
      store: { countOutboundCallsSince: () => 5 },
    }),
  );
  const denial = await gateBy(gates, "number_gate").run(baseCtx());
  assert.equal(denial.status, 429);
  assert.match(denial.body.error, /MAX_CALLS_PER_HOUR=5/);
});

test("number_gate: PER-ZIEL-CAP (config.safety.perTargetCallCap + perTargetWindowMs) -> 429 grund=ziel_limit", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      config: { perTargetCallCap: 2 },
      // Filter mit .to isoliert den Per-Ziel-Zaehler von den Stundenlimits (die ohne
      // .to-Filter zaehlen).
      store: { countOutboundCallsSince: (_since, filter) => (filter?.to ? 2 : 0) },
    }),
  );
  const denial = await gateBy(gates, "number_gate").run(baseCtx());
  assert.equal(denial.status, 429);
  assert.match(denial.audit.detail, /grund=ziel_limit/);
});

test("valid_text: ueberlanges objective -> 400, audit null", async () => {
  const { gates } = makeOutboundGates(makeDeps());
  const ctx = baseCtx({ objective: "x".repeat(501) });
  const denial = await gateBy(gates, "valid_text").run(ctx);
  assert.equal(denial.status, 400);
  assert.equal(denial.audit, null);
});

test("assistant_context: Flag an + ungueltiger Kontext -> 400, audit null", async () => {
  const { gates } = makeOutboundGates(makeDeps({ config: { assistantContextEnabled: true } }));
  const ctx = baseCtx({ b: { context: "kein-objekt" } });
  const denial = await gateBy(gates, "assistant_context").run(ctx);
  assert.equal(denial.status, 400);
  assert.equal(denial.audit, null);
});

test("resolve_outbound: keine aktive Tenant-Nummer -> 403 grund=keine_tenant_nummer", async () => {
  const { gates } = makeOutboundGates(makeDeps({ store: { load: () => ({ numbers: [] }) } }));
  const denial = await gateBy(gates, "resolve_outbound").run(baseCtx());
  assert.equal(denial.status, 403);
  assert.equal(
    denial.audit.detail,
    `to=${VALID_TO} grund=keine_tenant_nummer tenant=T requestedBy=owner`,
  );
});

test("budget: store.budgetExceeded -> 402 grund=budget tenant=..., kein requestedBy, Meldung nennt globalCapEur", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({ store: { budgetExceeded: () => true }, config: { maxBudgetCents: 800 } }),
  );
  const denial = await gateBy(gates, "budget").run(baseCtx());
  assert.equal(denial.status, 402);
  assert.match(denial.body.error, /Budget-Limit von 8 EUR/);
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=budget tenant=T`);
});

test("minutes: Plan-Minuten erschoepft -> 402 grund=minutes tenant=..., kein requestedBy", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      config: { paymentEnabled: true },
      store: { planMinutesExceeded: () => true },
    }),
  );
  const denial = await gateBy(gates, "minutes").run(baseCtx());
  assert.equal(denial.status, 402);
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=minutes tenant=T`);
});

test("reserve_budget: Store-Throw -> 402 grund=reserve_error, kein requestedBy (fail-closed)", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      store: {
        withStoreLock: () => {
          throw new Error("boom");
        },
      },
    }),
  );
  const denial = await gateBy(gates, "reserve_budget").run(baseCtx({ reserveCents: 100 }));
  assert.equal(denial.status, 402);
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=reserve_error tenant=T`);
});

test("reserve_budget: tryReserveOutboundBudget=false -> 402 grund=reserve requestedBy=...", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({ store: { tryReserveOutboundBudget: () => false } }),
  );
  const denial = await gateBy(gates, "reserve_budget").run(baseCtx({ reserveCents: 100 }));
  assert.equal(denial.status, 402);
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=reserve tenant=T requestedBy=owner`);
});

// === (c) Derivations-Gates (mutieren ctx, lehnen nie ab) =========================

test("resolve_identity: setzt ctx.requestedBy/ctx.tenantId, lehnt nie ab", async () => {
  const deps = makeDeps({ internalIdentity: () => null, requestTenant: () => "T" });
  const { gates } = makeOutboundGates(deps);
  const ctx = baseCtx({ requestedBy: undefined, tenantId: undefined });
  const denial = await gateBy(gates, "resolve_identity").run(ctx);
  assert.equal(denial, null);
  assert.equal(ctx.requestedBy, "owner");
  assert.equal(ctx.tenantId, "T");
});

test("compute_reserve: setzt ctx.maxDur/ctx.reserveCents, Cap greift bei ueberlanger Body-Dauer", async () => {
  const { gates } = makeOutboundGates(makeDeps());
  const ctx = baseCtx({ b: { max_duration_s: 999 } });
  const denial = await gateBy(gates, "compute_reserve").run(ctx);
  assert.equal(denial, null);
  assert.equal(ctx.maxDur, 300, "MAX_CALL_DURATION_CAP_S deckelt einen ueberlangen Body-Wert");
  assert.ok(
    Number.isInteger(ctx.reserveCents) && ctx.reserveCents >= 0,
    "reserveCents ist eine nicht-negative Ganzzahl (Wert selbst haengt am realen config-Singleton, s. Modul-Doc)",
  );
});

test("S1-6: compute_reserve mit negativem Body-max_duration_s faellt auf config-Default, KEINE negative Reserve", async () => {
  const { gates } = makeOutboundGates(makeDeps());
  const ctx = baseCtx({ b: { max_duration_s: -300 } });
  const denial = await gateBy(gates, "compute_reserve").run(ctx);
  assert.equal(denial, null);
  assert.equal(ctx.maxDur, 180, "negativer Body-Wert -> config-Default, NICHT -300 durchgereicht");
  assert.ok(
    Number.isInteger(ctx.reserveCents) && ctx.reserveCents > 0,
    "reserveCents bleibt eine positive Ganzzahl (kein negativer/Null-Reserve-Fallout)",
  );
});
