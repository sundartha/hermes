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
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { makeOutboundGates } from "../src/telephony/outbound-gates.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

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
// W2-B3: ein gueltiges NANP-Ziel (Format-Gate passiert, Land-Gate entscheidet).
const NANP_TARGET = "+12025550123";
// Globales Gate, das +1 MIT einschliesst - Vorbedingung fuer "das Profil kann nur senken".
const GLOBAL_CODES_INCLUDING_NANP = ["+49", "+33", "+44", "+1"];

// Vollstaendig durchgesteuerter Default-Store: JEDES Gate laesst sich mit diesen Werten
// isoliert aufrufen, ohne Vorbedingung zu verletzen (alle Praedikate "erlauben"). Tests
// ueberschreiben NUR die Methode(n), die das jeweils gepruefte Gate ablehnen lassen soll
// (P13 Build-Operate-Check: Setup-Boilerplate hinter diesem Helper versteckt).
function defaultStore() {
  return {
    // P15/T2: die Gate-Kette liest die Anzeigesprache aus dem Store. Der Budget-Test unten
    // pinnt den DEUTSCHEN Text byte-genau - der Fake waehlt sein Szenario deshalb explizit,
    // statt implizit vom Weltdefault zu leben.
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
    // GAP-03: kein Zahlungsbeanstandungs-Hold (Default-Store bleibt vollstaendig
    // durchsteuerbar, s. Datei-Kommentar).
    billingHoldActive: () => null,
    tenantActiveSubscriber: () => true,
    tenantSubscription: () => ({}),
    planMinutesExceeded: () => false,
    budgetExceeded: () => false,
    globalBudgetExceeded: () => false,
    withStoreLock: (fn) => fn(),
    tryReserveOutboundBudget: () => true,
    // P5a (Achsen in Anzeige/Ablehnung getrennt): tenantBudgetDenial/tenantReserveDenial
    // lesen diesen Snapshot fuer die Ablehnungstexte. reserveExceedsBudget entscheidet nur
    // noch, WELCHE Achse ein reserve_budget-Deny beschriftet - tryReserveOutboundBudget
    // bleibt die einzige Ja/Nein-Quelle (s. reserve_budget-Test unten).
    tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 350, remainingCents: 650 }),
    reserveExceedsBudget: () => true,
    // Budget-Achsen P6 (Fruehwarnung): der Fake soll die reale Kontraktflaeche spiegeln
    // statt sich auf das Schlucken eines TypeError zu verlassen. null = keine Warnung
    // faellig (Gate-Verhalten dieser Datei bleibt unberuehrt).
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

// Profil-Variante fuer die Land-Schnittmenge: EIN Feld weicht vom Default-Profil ab
// (F1/P13 - der Testrumpf bleibt auf die geprueften Codes reduziert).
const profileWithCountryCodes = (codes) => ({ ...baseCtx().profile, allowedCountryCodes: codes });

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
  assert.equal(denial.audit.detail, `to=${ctx.to} grund=denylist praefix=+870 requestedBy=owner`);
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

// OUT-03 (tasks/i18n-tests/05-auslandstelefonie.md): das Tenant-Profil ist eine
// SCHNITTMENGE mit dem globalen Gate, keine zweite Erlaubnis-Quelle. Der bestehende
// LAND-Gate-Test darueber prueft nur die globale Achse mit leerem Profil - hier
// entscheidet das Profil neben einer WEITEREN globalen Erlaubnis (kein Duplikat, G5).
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

  // Gegenrichtung: das globale Gate kennt nur +49 - kein Profilwert oeffnet +1.
  const widening = makeOutboundGates(makeDeps());
  for (const codes of [["+1"], ["*"], GLOBAL_CODES_INCLUDING_NANP]) {
    const blocked = await gateBy(widening.gates, "number_gate").run(
      baseCtx({ to: NANP_TARGET, profile: profileWithCountryCodes(codes) }),
    );
    assert.equal(blocked.status, 403, `Profil ${JSON.stringify(codes)} darf die globale Erlaubnis nicht erweitern`);
    assert.match(blocked.audit.detail, /grund=land/);
  }
});

// OUT-22: die drei "leeren" Profil-Zustaende ([] / undefined / null) muessen IDENTISCH
// wirken - !p || !p.length faengt alle drei. Zweite Haelfte ist load-bearing: "keine
// Zusatz-Einschraenkung" heisst NICHT "kein Gate" (die globale Achse bleibt).
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

// OUT-28: die Einzel-Gate-Tests darueber pruefen je EINE Verletzung isoliert. Hier sind
// MEHRERE Gates gleichzeitig verletzt - bewiesen wird die Praezedenz (Land vor
// Stundenlimit vor Ziel-Cap) an EINEM und demselben gueltigen US-Ziel. Der Denylist-Vorrang
// davor traegt OUT-15 (test/number-gate.test.js).
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

// GAP-10: der Ablehnungstext nennt den Env-Namen NICHT mehr (er darf die
// Konfigurationsflaeche nicht preisgeben). Die PA-15-Intention - ein vertauschter
// Blattname wird gefangen - bleibt SCHAERFER erhalten: das Gate feuert exakt am
// Blattwert (5 -> 429) und exakt darunter nicht (4 -> null).
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

// === (d) Doku-Drift der Kettenlaenge =============================================

// OUT-14 (SOLL, heute rot): der Modul-Kommentar in src/telephony/outbound-gates.js nennt
// "16 Glieder", die Kette traegt 17. Bewusst als SOLL formuliert, NICHT als gruener Pin der
// falschen Zahl (R-G-Abweichung von der Katalog-Erwartung "gruen"): ein Ist-Pin auf "16"
// wuerde die Doku-Drift zum Sollzustand erklaeren und beim Korrigieren des Kommentars
// brechen. So faellt der Test heute, und er heilt genau dann, wenn jemand die Zahl richtig
// stellt - danach ist er der Waechter gegen die naechste Drift (G27: Struktur statt Disziplin).
const CHAIN_LENGTH_COMMENT = /Gate-Kette \((\d+) Glieder\)/;

test("OUT-14 (SOLL, rot) - die im Modul-Kommentar genannte Gliederzahl deckt sich mit der tatsaechlichen Gate-Kette", () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, "src", "telephony", "outbound-gates.js"), "utf8");
  const match = source.match(CHAIN_LENGTH_COMMENT);
  assert.ok(match, "der Modul-Kommentar nennt die Gliederzahl der Gate-Kette");
  const { gates } = makeOutboundGates(makeDeps());
  assert.equal(Number(match[1]), gates.length, "Kommentar-Zahl == Laenge der gebauten Kette");
});
