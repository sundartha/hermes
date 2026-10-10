import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOutboundGates, runOutboundGates, tariffCentsPerMin } from "../src/telephony/outbound-gates.js";
import { emergencyBrakeSeconds } from "../src/call-duration.js";
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
  "ani_ownership",
  "budget",
  "minutes",
  "compute_reserve",
  "reserve_budget",
];

const VALID_TO = "+491711234567";
const NANP_TARGET = "+12025550123";
const GLOBAL_CODES_INCLUDING_NANP = ["+49", "+33", "+44", "+1"];

function defaultStore() {
  return {
    tenantLanguage: () => "de",
    countOutboundCallsSince: () => 0,
    tenantPrivateNumber: () => null,
    tenantGeo: () => ({ country: "DE" }),
    load: () => ({
      numbers: [{ tenantId: "T", status: "active", provider: "telnyx", e164: "+491700000000" }],
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
    withStoreLock: (fn) => fn(),
    tryReserveOutboundBudget: () => true,
    tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 350, remainingCents: 650 }),
    reserveExceedsBudget: () => true,
    claimPlatformSpendWarning: () => null,
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

const profileWithCountryCodes = (codes) => ({ ...baseCtx().profile, allowedCountryCodes: codes });

test("Gate-Reihenfolge ist der eingefrorene Snapshot", () => {
  const { gates } = makeOutboundGates(makeDeps());
  assert.deepEqual(
    gates.map((g) => g.name),
    EXPECTED_ORDER,
  );
});

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
  let denial = null;
  for (const gate of gates) {
    denial = await gate.run(ctx);
    if (denial) break;
  }
  assert.equal(denial.status, 403);
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=frozen`);
  assert.equal(requestTenantCalls, 0, "outbound_frozen feuert VOR resolve_identity");
});

const PAUSENTEXT = "Ausgehende Anrufe sind pausiert (Anrufpause).";
const SPERRTEXT = "Outbound-Anrufe sind derzeit gesperrt (OUTBOUND_FROZEN).";
const SPERRFAELLE = [
  { fall: "nur Anrufpause", frozen: false, pause: true, text: PAUSENTEXT, zusatz: " quelle=anrufpause" },
  { fall: "nur OUTBOUND_FROZEN", frozen: true, pause: false, text: SPERRTEXT, zusatz: "" },
  { fall: "beides an", frozen: true, pause: true, text: SPERRTEXT, zusatz: "" },
];

function sperrGates(frozen, pause, requestTenant = () => "T") {
  const deps = makeDeps({ config: { outboundFrozen: frozen }, store: { anrufpauseAktiv: () => pause } });
  return makeOutboundGates({ ...deps, requestTenant }).gates;
}

test("outbound_frozen: Anrufpause und OUTBOUND_FROZEN sperren mit eigenem Text und Audit, OUTBOUND_FROZEN gewinnt", async () => {
  for (const { fall, frozen, pause, text, zusatz } of SPERRFAELLE) {
    const mandantenAbfragen = [];
    const gates = sperrGates(frozen, pause, () => mandantenAbfragen.push(fall));
    const denial = await runOutboundGates({ gates, ctx: baseCtx() });
    assert.equal(denial.status, 403, fall);
    assert.deepEqual(denial.body, { error: text }, fall);
    assert.deepEqual(
      denial.audit,
      { event: "place_call_denied", grund: "frozen", detail: `to=${VALID_TO} grund=frozen${zusatz}` },
      fall,
    );
    assert.deepEqual(mandantenAbfragen, [], fall);
  }
});

test("outbound_frozen: ohne Anrufpause und ohne OUTBOUND_FROZEN laesst das Gate mit null durch", async () => {
  assert.equal(await gateBy(sperrGates(false, false), "outbound_frozen").run(baseCtx()), null);
  assert.equal(await gateBy(makeOutboundGates(makeDeps()).gates, "outbound_frozen").run(baseCtx()), null);
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
  assert.equal(denial.audit.detail, `to=${ctx.to} grund=denylist praefix=+870 requestedBy=owner`);
  assert.ok(!denial.audit.detail.includes("tenant="));
});

test("number_gate: LAND-Gate (config.safety.allowedCountryCodes) -> 403 grund=land", async () => {
  const { gates } = makeOutboundGates(makeDeps());
  const ctx = baseCtx({ to: "+15551234567" });
  const denial = await gateBy(gates, "number_gate").run(ctx);
  assert.equal(denial.status, 403);
  assert.match(denial.audit.detail, /grund=land/);
});

test("OUT-03 (Mechanismus, gruen) - das Tenant-Profil kann das Laender-Gate nur einschraenken, nie erweitern", async () => {
  const narrowing = makeOutboundGates(makeDeps({ config: { allowedCountryCodes: GLOBAL_CODES_INCLUDING_NANP } }));
  const narrowGate = gateBy(narrowing.gates, "number_gate");
  const denial = await narrowGate.run(baseCtx({ to: NANP_TARGET, profile: profileWithCountryCodes(["+49"]) }));
  assert.equal(denial.status, 403, "global erlaubtes +1 wird vom engeren Profil gesperrt");
  assert.match(denial.audit.detail, /grund=land/);
  assert.equal(
    await narrowGate.run(baseCtx({ to: VALID_TO, profile: profileWithCountryCodes(["+49"]) })),
    null,
    "dasselbe Profil laesst sein eigenes Land weiterhin durch",
  );

  const widening = makeOutboundGates(makeDeps());
  for (const codes of [["+1"], ["*"], GLOBAL_CODES_INCLUDING_NANP]) {
    const blocked = await gateBy(widening.gates, "number_gate").run(
      baseCtx({ to: NANP_TARGET, profile: profileWithCountryCodes(codes) }),
    );
    assert.equal(blocked.status, 403, `Profil ${JSON.stringify(codes)} darf die globale Erlaubnis nicht erweitern`);
    assert.match(blocked.audit.detail, /grund=land/);
  }
});

test("OUT-22 (Mechanismus, gruen) - leere/undefinierte Profil-allowedCountryCodes bedeuten keine Zusatz-Einschraenkung", async () => {
  const { gates } = makeOutboundGates(makeDeps());
  const numberGate = gateBy(gates, "number_gate");
  for (const codes of [[], undefined, null]) {
    assert.equal(
      await numberGate.run(baseCtx({ to: VALID_TO, profile: profileWithCountryCodes(codes) })),
      null,
      `leeres Profil (${JSON.stringify(codes)}) darf das global erlaubte Ziel nicht sperren`,
    );
    const blocked = await numberGate.run(baseCtx({ to: NANP_TARGET, profile: profileWithCountryCodes(codes) }));
    assert.equal(blocked.status, 403, `leeres Profil (${JSON.stringify(codes)}) oeffnet die globale Achse NICHT`);
  }
});

test("OUT-28 (Mechanismus, gruen) - bei einem gueltigen US-Ziel entscheidet deterministisch das erste verletzte Gate", async () => {
  const exhausted = { countOutboundCallsSince: () => Number.MAX_SAFE_INTEGER };
  const land = makeOutboundGates(
    makeDeps({
      config: { allowedCountryCodes: ["+49"], maxCallsPerHour: 0, perTargetCallCap: 0 },
      store: exhausted,
    }),
  );
  const landDenial = await gateBy(land.gates, "number_gate").run(baseCtx({ to: NANP_TARGET }));
  assert.equal(landDenial.status, 403);
  assert.match(landDenial.audit.detail, /grund=land/, "Land schlaegt Stundenlimit und Ziel-Cap");

  const hourly = makeOutboundGates(
    makeDeps({
      config: { allowedCountryCodes: ["+1"], maxCallsPerHour: 0, perTargetCallCap: 0 },
      store: exhausted,
    }),
  );
  const hourlyDenial = await gateBy(hourly.gates, "number_gate").run(baseCtx({ to: NANP_TARGET }));
  assert.equal(hourlyDenial.status, 429);
  assert.match(hourlyDenial.audit.detail, /grund=stundenlimit/, "erlaubtes Land -> naechstes Glied entscheidet");

  const perTarget = makeOutboundGates(
    makeDeps({
      config: { allowedCountryCodes: ["+1"], maxCallsPerHour: 100, perTargetCallCap: 0 },
      store: { countOutboundCallsSince: (_since, filter) => (filter?.to ? 1 : 0) },
    }),
  );
  const perTargetDenial = await gateBy(perTarget.gates, "number_gate").run(baseCtx({ to: NANP_TARGET }));
  assert.equal(perTargetDenial.status, 429);
  assert.match(perTargetDenial.audit.detail, /grund=ziel_limit/, "Stundenlimit frei -> Ziel-Cap entscheidet");
});

test("number_gate: STUNDENLIMIT (config.safety.maxCallsPerHour) -> 429, Gate feuert exakt am Blattwert", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      config: { maxCallsPerHour: 5 },
      store: { countOutboundCallsSince: () => 5 },
    }),
  );
  const denial = await gateBy(gates, "number_gate").run(baseCtx());
  assert.equal(denial.status, 429);
  assert.match(denial.audit.detail, /grund=stundenlimit/);
  assert.ok(!/MAX_CALLS_PER_HOUR/.test(denial.body.error), "kein interner Env-Name im Kundentext");

  const { gates: below } = makeOutboundGates(
    makeDeps({
      config: { maxCallsPerHour: 5 },
      store: { countOutboundCallsSince: () => 4 },
    }),
  );
  assert.equal(
    await gateBy(below, "number_gate").run(baseCtx()),
    null,
    "ein Call unter dem Blattwert passiert - ein vertauschter Blattname faellt hier auf",
  );
});

test("number_gate: PER-ZIEL-CAP (config.safety.perTargetCallCap + perTargetWindowMs) -> 429 grund=ziel_limit", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      config: { perTargetCallCap: 2 },
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

test("budget: store.budgetExceeded -> 402 grund=budget_tenant tenant=..., kein requestedBy, Meldung nennt EIGENE Decke", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({ store: { budgetExceeded: () => true }, config: { platformSpendCapCents: 800 } }),
  );
  const denial = await gateBy(gates, "budget").run(baseCtx());
  assert.equal(denial.status, 402);
  assert.equal(denial.body.error, "Dein Budget-Limit ist erreicht: 3.50 von 10.00 EUR verbraucht.");
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=budget_tenant tenant=T`);
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

test("reserve_budget: tryReserveOutboundBudget=false -> 402 grund=reserve_ueber_rest requestedBy=...", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({ store: { tryReserveOutboundBudget: () => false } }),
  );
  const denial = await gateBy(gates, "reserve_budget").run(baseCtx({ reserveCents: 100 }));
  assert.equal(denial.status, 402);
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=reserve_ueber_rest tenant=T requestedBy=owner`);
});

const FREMDLAENDISCHE_DID = "+12025550123";

test("GAP-19 (SOLL, rot) - ein Anruf unter fremdlaendischer Absender-DID passiert die Gate-Kette nicht unbemerkt", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      store: {
        load: () => ({
          numbers: [{ tenantId: "T", status: "active", provider: "telnyx", e164: FREMDLAENDISCHE_DID }],
        }),
      },
    }),
  );
  const ctx = baseCtx();
  let denial = null;
  for (const gate of gates) {
    denial = await gate.run(ctx);
    if (denial) break;
  }

  assert.equal(ctx.fromNumber, FREMDLAENDISCHE_DID, "Vorbedingung: der Absender ist wirklich die US-DID");
  assert.ok(
    denial,
    "kein Gate sieht, dass ein deutscher Tenant ein deutsches Ziel unter US-Nummer anruft - " +
      "weder Ablehnung noch Audit-Spur, obwohl genau diese Konstellation Zustellraten und Rufnummern-Reputation kostet",
  );
});

const FREMDES_ZIEL_GB = "+442071234567";
const US_DID_STORE = {
  load: () => ({
    numbers: [{ tenantId: "T", status: "active", provider: "telnyx", e164: FREMDLAENDISCHE_DID }],
  }),
};

test("resolve_outbound: Herkunfts-Gate - DE-Tenant, DE-Ziel, US-DID -> 403 grund=herkunft", async () => {
  const { gates } = makeOutboundGates(makeDeps({ store: US_DID_STORE }));
  const ctx = baseCtx();
  const denial = await gateBy(gates, "resolve_outbound").run(ctx);
  assert.equal(denial.status, 403);
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=herkunft tenant=T requestedBy=owner`);
  assert.equal(ctx.fromNumber, FREMDLAENDISCHE_DID, "die Derivation wird von der Ablehnung nicht verschluckt");
});

test("resolve_outbound: Glueckspfad - eigene DE-DID zum DE-Ziel bleibt erlaubt", async () => {
  const { gates } = makeOutboundGates(makeDeps());
  const ctx = baseCtx();
  assert.equal(await gateBy(gates, "resolve_outbound").run(ctx), null);
  assert.equal(ctx.fromNumber, "+491700000000");
  assert.equal(ctx.outboundProvider, "telnyx");
  assert.ok(ctx.numberRecord, "numberRecord bleibt der Geo-Anker der Sprachaufloesung");
});

test("resolve_outbound: echter Auslandsanruf (DE-Tenant, GB-Ziel, DE-DID) bleibt erlaubt", async () => {
  const { gates } = makeOutboundGates(makeDeps());
  assert.equal(
    await gateBy(gates, "resolve_outbound").run(baseCtx({ to: FREMDES_ZIEL_GB })),
    null,
    "die Sperre trifft NUR Inlandsanrufe - Auslandstelefonie bleibt unberuehrt",
  );
});

test("resolve_outbound: ohne bekanntes Tenant-Herkunftsland faellt kein Urteil", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({ store: { ...US_DID_STORE, tenantGeo: () => ({ country: null }) } }),
  );
  assert.equal(
    await gateBy(gates, "resolve_outbound").run(baseCtx()),
    null,
    "ein Anruf, von dem niemand weiss, ob er ein Inlandsanruf ist, wird nicht abgelehnt",
  );
});

test("resolve_outbound: gesetztes FORCE_NUMBER_COUNTRY ist der Betriebs-Ack -> kein Herkunfts-Deny", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({ store: US_DID_STORE, config: { forceNumberCountry: "US" } }),
  );
  assert.equal(
    await gateBy(gates, "resolve_outbound").run(baseCtx()),
    null,
    "der erklaerte Override haelt den Live-Pfad offen - die Sichtbarkeit traegt der Boot-Guard",
  );
});

test("resolve_identity: setzt ctx.requestedBy/ctx.tenantId, lehnt nie ab", async () => {
  const deps = makeDeps({ internalIdentity: () => null, requestTenant: () => "T" });
  const { gates } = makeOutboundGates(deps);
  const ctx = baseCtx({ requestedBy: undefined, tenantId: undefined });
  const denial = await gateBy(gates, "resolve_identity").run(ctx);
  assert.equal(denial, null);
  assert.equal(ctx.requestedBy, "owner");
  assert.equal(ctx.tenantId, "T");
});

const brakeOfDefaultStore = () =>
  emergencyBrakeSeconds({
    remainingCents: defaultStore().tenantBudgetSnapshot().remainingCents,
    tariffCentsPerMin: tariffCentsPerMin(VALID_TO, undefined),
  });

test("compute_reserve: setzt ctx.maxDur/ctx.reserveCents, die Notbremse deckelt eine ueberlange Body-Dauer", async () => {
  const { gates } = makeOutboundGates(makeDeps());
  const ctx = baseCtx({ b: { max_duration_s: 999999 } });
  const denial = await gateBy(gates, "compute_reserve").run(ctx);
  assert.equal(denial, null);
  assert.equal(
    ctx.maxDur,
    brakeOfDefaultStore(),
    "die guthaben-abgeleitete Notbremse deckelt einen ueberlangen Body-Wert",
  );
  assert.ok(
    Number.isInteger(ctx.reserveCents) && ctx.reserveCents >= 0,
    "reserveCents ist eine nicht-negative Ganzzahl (Wert selbst haengt am realen config-Singleton, s. Modul-Doc)",
  );
});

test("S1-6: compute_reserve mit negativem Body-max_duration_s faellt auf die Notbremse, KEINE negative Reserve", async () => {
  const { gates } = makeOutboundGates(makeDeps());
  const ctx = baseCtx({ b: { max_duration_s: -300 } });
  const denial = await gateBy(gates, "compute_reserve").run(ctx);
  assert.equal(denial, null);
  assert.equal(
    ctx.maxDur,
    brakeOfDefaultStore(),
    "negativer Body-Wert -> Notbremse, NICHT -300 durchgereicht",
  );
  assert.ok(
    Number.isInteger(ctx.reserveCents) && ctx.reserveCents > 0,
    "reserveCents bleibt eine positive Ganzzahl (kein negativer/Null-Reserve-Fallout)",
  );
});

const EXPECTED_CHAIN_LENGTH = 18;

test("die Gate-Kette hat 18 Glieder (OUT-14)", () => {
  const { gates } = makeOutboundGates(makeDeps());
  assert.equal(gates.length, EXPECTED_CHAIN_LENGTH);
});
