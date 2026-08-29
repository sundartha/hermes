// P5a (Achsen in Anzeige/Ablehnung getrennt): die "budget"- und "reserve_budget"-Gates
// (src/telephony/outbound-gates.js) muessen nach Grund getrennte Texte + Audit-Gruende
// liefern - der lesbare Bucket nennt die EIGENE Decke/Verbrauch/Fehlbetrag, der unlesbare
// bleibt ZIFFERNFREI (kein "NaN EUR" auf einer Geld-Kante). Seit KS-P9 gibt es keine
// Plattform-Ablehnung mehr, die hier zu pruefen waere. Muster
// test/outbound-gates-order.test.js: makeOutboundGates(deps) + gate.run(ctx) DIREKT,
// offline, kein Spawn, keine DB. Beweist NUR Anzeige/Text/Audit-Grund - keine der
// Gate-PRAEDIKATE (budgetExceeded/reserveExceedsBudget/tryReserveOutboundBudget) wird
// hier veraendert, nur ueber Mocks vorgegeben (die reale Praedikat-Suite bleibt
// outbound-gates-order.test.js/effective-cap-fallback.test.js/budget-nan-fail-closed.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOutboundGates } from "../src/telephony/outbound-gates.js";
import { spendMonthEndDate } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const VALID_TO = "+491711234567";
// Vorgabe 4 (verbindliche Streichung): keine ausfuehrbare Dauer in irgendeinem
// Ablehnungstext. Ein Treffer hier waere eine maschinenlesbare Umgehungsanleitung.
const DURATION_LEAK = /(max_duration|Sekunden|Dauer|Minute)/;

// Vollstaendig durchgesteuerter Default-Store (Muster outbound-gates-order.test.js):
// beide Gates lassen sich isoliert aufrufen, ohne dass ein Achsen-Denial feuert. Tests
// ueberschreiben NUR die Methode(n), die die jeweils gepruefte Achse feuern lassen sollen.
function defaultStore(overrides = {}) {
  return {
    // P15/T2: die Gate-Kette liest die Anzeigesprache aus dem Store. Diese Datei pinnt die
    // DEUTSCHEN Achsentexte byte-genau - der Fake waehlt sein Szenario deshalb explizit,
    // statt implizit vom Weltdefault zu leben.
    tenantLanguage: () => "de",
    budgetExceeded: () => false,
    tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 350, remainingCents: 650 }),
    tryReserveOutboundBudget: () => true,
    reserveExceedsBudget: () => false,
    withStoreLock: (fn) => fn(),
    // OUTBOUND-E4: das ani_ownership-Gate liest store.load().outageAlerts - leer heisst
    // "keine Messung", das Gate bleibt dann ohnehin aus (outboundAniGateEnabled default
    // false in defaultConfig unten).
    load: () => ({ outageAlerts: [] }),
    // Budget-Achsen P6 (Fruehwarnung): der Fake soll die reale Kontraktflaeche spiegeln
    // statt sich auf das Schlucken eines TypeError zu verlassen. null = keine Warnung
    // faellig (diese Datei prueft Ablehnungstexte, nicht die Warnung).
    claimPlatformSpendWarning: () => null,
    ...overrides,
  };
}

function defaultConfig(overrides = {}) {
  return withConfigNamespaces({ outboundFrozen: false, platformSpendCapCents: 800, ...overrides });
}

function makeDeps(o = {}) {
  return {
    store: defaultStore(o.store),
    config: defaultConfig(o.config),
    requestTenant: () => "T",
    internalIdentity: () => null,
    OWNER_ID: "owner",
    TENANT_REJECT: "reject",
    ...(o.aniOwnershipRecheck ? { aniOwnershipRecheck: o.aniOwnershipRecheck } : {}),
  };
}

const gateBy = (gates, name) => gates.find((g) => g.name === name);
const baseCtx = (overrides = {}) => ({ to: VALID_TO, tenantId: "T", requestedBy: "owner", ...overrides });

// ==== budget-Gate =================================================================

test("budget-Gate, Tenant-Achse: eigene Decke + eigener Verbrauch, grund=budget_tenant", async () => {
  const { gates } = makeOutboundGates(makeDeps({ store: { budgetExceeded: () => true } }));
  const denial = await gateBy(gates, "budget").run(baseCtx());
  assert.equal(denial.status, 402);
  assert.equal(denial.body.error, "Dein Budget-Limit ist erreicht: 3.50 von 10.00 EUR verbraucht.");
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=budget_tenant tenant=T`);
});

test("budget-Gate, D7 unbuchbarer Bucket: ziffernfreier Sperrtext, grund bleibt budget_tenant", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      store: {
        budgetExceeded: () => true,
        tenantBudgetSnapshot: () => ({ capCents: 800, spentCents: null, remainingCents: null }),
      },
    }),
  );
  const denial = await gateBy(gates, "budget").run(baseCtx());
  assert.equal(
    denial.body.error,
    "Dein Budget ist gesperrt: der Verbrauchsstand ist nicht lesbar. Bitte Betreiber kontaktieren.",
  );
  assert.ok(!/\d/.test(denial.body.error), "kein 'NaN EUR' auf einer Geld-Kante");
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=budget_tenant tenant=T`);
});

// ==== reserve_budget-Gate ==========================================================

test("reserve_budget-Gate, Tenant-Achse Rest>0 (D2-Totband): Fehlbetrag + Spend-Monat-Ende, grund=reserve_ueber_rest", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      store: {
        tryReserveOutboundBudget: () => false,
        reserveExceedsBudget: () => true,
        tenantBudgetSnapshot: () => ({ capCents: 800, spentCents: 779, remainingCents: 21 }),
      },
    }),
  );
  const denial = await gateBy(gates, "reserve_budget").run(baseCtx({ reserveCents: 60 }));
  const monthEnd = spendMonthEndDate(Date.now());
  assert.equal(denial.status, 402);
  assert.equal(
    denial.body.error,
    `Dieser Anruf passt nicht mehr in dein Budget: es fehlen 0.39 EUR. Aktueller Spend-Monat endet am ${monthEnd}.`,
  );
  assert.match(denial.body.error, /endet am \d{4}-\d{2}-\d{2}\.$/);
  assert.ok(!DURATION_LEAK.test(denial.body.error), "keine ausfuehrbare Dauer im Ablehnungstext (Vorgabe 4)");
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=reserve_ueber_rest tenant=T requestedBy=owner`);
});

test("reserve_budget-Gate, Tenant-Achse Rest<=0 (erschoepft): grund=reserve_erschoepft", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      store: {
        tryReserveOutboundBudget: () => false,
        reserveExceedsBudget: () => true,
        tenantBudgetSnapshot: () => ({ capCents: 800, spentCents: 800, remainingCents: 0 }),
      },
    }),
  );
  const denial = await gateBy(gates, "reserve_budget").run(baseCtx({ reserveCents: 60 }));
  const monthEnd = spendMonthEndDate(Date.now());
  assert.equal(denial.status, 402);
  assert.equal(
    denial.body.error,
    `Dein Budget ist erschoepft: es fehlen 0.60 EUR. Aktueller Spend-Monat endet am ${monthEnd}.`,
  );
  assert.ok(!DURATION_LEAK.test(denial.body.error), "keine ausfuehrbare Dauer im Ablehnungstext (Vorgabe 4)");
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=reserve_erschoepft tenant=T requestedBy=owner`);
});

// KS-P9: tryReserveOutboundBudget lehnt nur noch aus ZWEI Gruenden ab - Tenant-Decke
// (reserveExceedsBudget true, oben abgedeckt) oder ein unbuchbarer Reserve-Betrag
// (isBookableCents-Riegel). Dieser Rest-Fall darf keine Zahl nennen: "NaN EUR" waere eine
// Falschauskunft auf einer Geld-Kante.
test("reserve_budget-Gate, unbuchbarer Reserve-Betrag: ziffernfreier Sperrtext, grund=reserve_erschoepft", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({ store: { tryReserveOutboundBudget: () => false, reserveExceedsBudget: () => false } }),
  );
  const denial = await gateBy(gates, "reserve_budget").run(baseCtx({ reserveCents: 60 }));
  assert.equal(denial.status, 402);
  assert.equal(
    denial.body.error,
    "Dein Budget ist gesperrt: der Verbrauchsstand ist nicht lesbar. Bitte Betreiber kontaktieren.",
  );
  assert.ok(!/\d/.test(denial.body.error), "kein 'NaN EUR' auf einer Geld-Kante");
  assert.ok(!DURATION_LEAK.test(denial.body.error));
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=reserve_erschoepft tenant=T requestedBy=owner`);
});

test("reserve_budget-Gate, D7 unbuchbarer Bucket: ziffernfreier Sperrtext, grund=reserve_erschoepft", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      store: {
        tryReserveOutboundBudget: () => false,
        reserveExceedsBudget: () => true,
        tenantBudgetSnapshot: () => ({ capCents: 800, spentCents: null, remainingCents: null }),
      },
    }),
  );
  const denial = await gateBy(gates, "reserve_budget").run(baseCtx({ reserveCents: 60 }));
  assert.equal(
    denial.body.error,
    "Dein Budget ist gesperrt: der Verbrauchsstand ist nicht lesbar. Bitte Betreiber kontaktieren.",
  );
  assert.ok(!/\d/.test(denial.body.error), "kein 'NaN EUR' auf einer Geld-Kante");
  assert.ok(!DURATION_LEAK.test(denial.body.error));
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=reserve_erschoepft tenant=T requestedBy=owner`);
});

// ==== ani_ownership-Gate (OUTBOUND-E4) ============================================
// Muster der beiden Gates oben: der neue Grund ani_not_owned muss diagnostizierbar
// (eigenes Token, kein generischer Fehler) UND PII-frei sein (keine Rufnummer im Text).

const EINE_MINUTE_MS = 60000;
const HTTP_SERVICE_UNAVAILABLE = 503;
const FRISCHE_MS = "2026-08-27T16:45:00.000Z";
const NOW_MS = Date.parse(FRISCHE_MS) + EINE_MINUTE_MS; // 1 min spaeter, klar innerhalb jeder Frist

test("ani_ownership-Gate: frische Messung + Nachmessung bestaetigt -> 503, grund=ani_not_owned, PII-frei", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      config: { outboundAniGateEnabled: true, outboundAniGateMaxAgeMs: 900000 },
      store: {
        load: () => ({ outageAlerts: [{ code: "drift:ownership_lost", closedAt: null, lastSeenAt: FRISCHE_MS }] }),
      },
      aniOwnershipRecheck: async () => true,
    }),
  );
  const nowStub = () => NOW_MS;
  const echterDateNow = Date.now;
  Date.now = nowStub;
  let denial;
  try {
    denial = await gateBy(gates, "ani_ownership").run(baseCtx({ fromNumber: "+15739090177" }));
  } finally {
    Date.now = echterDateNow;
  }
  assert.equal(denial.status, HTTP_SERVICE_UNAVAILABLE);
  assert.equal(denial.audit.grund, "ani_not_owned");
  // to= im Detail ist Bestandsvertrag (jedes Gate traegt das Ziel, s. denialAudit) - PII-
  // frei heisst hier: die Plattform-ANI selbst (ctx.fromNumber, die eigentliche
  // Bestandsgroesse dieses Befunds) taucht NICHT auf.
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=ani_not_owned tenant=T requestedBy=owner`);
  assert.ok(!denial.body.error.includes("+15739090177"), `keine ANI im Ablehnungstext: ${denial.body.error}`);
  assert.ok(!denial.audit.detail.includes("+15739090177"), `keine ANI im Audit-Detail: ${denial.audit.detail}`);
});

// ==== spendMonthEndDate: Grenzfaelle gegen hartkodierte Erwartungen ================

test("spendMonthEndDate: letzter Tag des UTC-Kalendermonats, inkl. Dezember- und Schaltjahr-Grenzfall", () => {
  assert.equal(spendMonthEndDate(Date.UTC(2026, 6, 19)), "2026-07-31", "Juli -> 31 Tage");
  assert.equal(spendMonthEndDate(Date.UTC(2026, 11, 5)), "2026-12-31", "Dezember-Ueberlauf normalisiert sich selbst");
  assert.equal(spendMonthEndDate(Date.UTC(2024, 1, 10)), "2024-02-29", "Schaltjahr-Februar");
});
