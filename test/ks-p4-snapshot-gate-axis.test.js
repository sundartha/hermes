// KS-P4: tenantBudgetSnapshot (Anzeige/Ablehnungstexte, outbound-gates.js) liest seit
// dieser Phase DIESELBE aufgeloeste Gate-Groesse (gateUsageCents ueber tenantUsageAxes)
// wie die Gate-Praedikate budgetExceeded/reserveExceedsBudget - vorher las der Snapshot
// den rohen Lebenszeit-Zaehler usageFor(...).costCents. Diese Datei pinnt die dadurch
// STRUKTURELL erzwungene Invariante "ein Fehlbetrag reserveCents - remainingCents kann
// nur dann negativ werden, wenn die Gate-Entscheidung ablehnt" - vor dieser Phase konnte
// eine bookCostCorrectionCents-Korrektur (senkt NUR costCents, nie die Spend-Monat-Achse)
// genau diesen Widerspruch erzeugen: das Gate sperrt, der Ablehnungstext zeigt trotzdem
// einen negativen Fehlbetrag.
//
// Ops-Ebene + Gate-Ebene in einer Datei (Muster test/ks-p9-platform-axis-observation.test.js),
// offline, kein Spawn, keine DB (F.I.R.S.T.).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  setTenantBudget,
  addVoiceUsageCostCents,
  stampBudgetPeriod,
  bookCostCorrectionCents,
  NO_CHARGE_ANCHORS,
  tenantBudgetSnapshot,
  budgetExceeded,
  reserveExceedsBudget,
} from "../src/store/state-ops.js";
import { emptyUsage } from "../src/store/defaults.js";
import { makeOutboundGates } from "../src/telephony/outbound-gates.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { PRICES } from "./_prices.js";

const TENANT = "ks_p4_tenant";
const CAP_CENTS = 900;
const JULY_ISO = "2026-07-19T10:00:00.000Z";
const PERIOD_START = "2026-07-01T00:00:00.000Z";
const RESERVE_SAMPLES = [50, 250, 300, 900];
// Vorgabe 4 (test/deny-diagnosability.test.js): keine ausfuehrbare Dauer im Ablehnungstext.
const DURATION_LEAK = /(max_duration|Sekunden|Dauer|Minute)/;
// Ziffernfreiheit an einer Geld-Kante: ein negativer EUR-Betrag im gerenderten Text waere
// die Falschauskunft, die diese Phase behebt. NICHT einfach "-\d" (traefe faelschlich das
// Spend-Monat-Enddatum, z.B. "2026-07-31") - der Betrag steht unmittelbar vor "EUR".
const NEGATIVE_AMOUNT = /-\d[\d.]*\s*EUR/;

const FLAG_OFF = PRICES;
const FLAG_ON = { ...PRICES, budgetMonthEnabled: true };

// PERIODE (Flag AUS -> GAP-01 Perioden-Fenster): Baseline 900 bei Periodenstart, danach
// +100 -> Gate-Groesse 100, Lebenszeit-Zaehler bleibt bei 1000.
function periodeFixture() {
  const s = makeDefaultState();
  setTenantBudget(s, TENANT, { budgetCents: CAP_CENTS, hardCapCents: CAP_CENTS });
  addVoiceUsageCostCents(s, TENANT, 900, JULY_ISO);
  stampBudgetPeriod(s, TENANT, PERIOD_START);
  addVoiceUsageCostCents(s, TENANT, 100, JULY_ISO);
  return s;
}

// LIVE (Flag AN, live gemessener Zustand 4,23 EUR Lebenszeit / 12,84 EUR Spend-Monat):
// bookCostCorrectionCents(-861) senkt laut Code NUR costCents (Lebenszeit), NIE die
// Spend-Monat-Achse - Gate-Groesse bleibt 1284, Lebenszeit faellt auf 423.
function liveFixture() {
  const s = makeDefaultState();
  setTenantBudget(s, TENANT, { budgetCents: CAP_CENTS, hardCapCents: CAP_CENTS });
  addVoiceUsageCostCents(s, TENANT, 1284, JULY_ISO);
  stampBudgetPeriod(s, TENANT, PERIOD_START);
  // KS-P5: ohne Belastungs-Anker bleibt die Gutschrift auf der Lebenszeit-Achse - genau
  // der Zustand, den diese Fixture braucht (Gate-Groesse 1284, Lebenszeit 423).
  bookCostCorrectionCents(s, { tenantId: TENANT, deltaCents: -861, chargeAnchors: NO_CHARGE_ANCHORS, nowIso: JULY_ISO });
  return s;
}

const FIXTURES = [
  { name: "PERIODE", build: periodeFixture, cfg: FLAG_OFF },
  { name: "LIVE", build: liveFixture, cfg: FLAG_ON },
];

// ---- T1: Invariante Reserve/Rest, kein Zahlenwert ----------------------------------

test("T1 Invariante: reserveExceedsBudget und der Fehlbetrag (reserveCents - remainingCents) stimmen ueberein", () => {
  for (const { name, build, cfg } of FIXTURES) {
    for (const reserveCents of RESERVE_SAMPLES) {
      const s = build();
      const snapshot = tenantBudgetSnapshot(s, TENANT, cfg, JULY_ISO);
      const gateDenies = reserveExceedsBudget(s, TENANT, reserveCents, cfg, JULY_ISO);
      const missing = reserveCents - snapshot.remainingCents;
      assert.equal(
        gateDenies,
        missing > 0,
        `${name}, reserveCents=${reserveCents}: Gate-Entscheidung und Anzeige-Fehlbetrag muessen dieselbe Aussage treffen`,
      );
    }
  }
});

// ---- T2: der Owner-Befund - negativer Fehlbetrag wird strukturell unmoeglich -------

test("T2 LIVE-Fixture, reserveCents=300: kein negativer Fehlbetrag mehr bei einer Ablehnung", () => {
  const s = liveFixture();
  const reserveCents = 300;
  const snapshot = tenantBudgetSnapshot(s, TENANT, FLAG_ON, JULY_ISO);
  const gateDenies = reserveExceedsBudget(s, TENANT, reserveCents, FLAG_ON, JULY_ISO);
  assert.equal(gateDenies, true, "Vorbedingung: das Gate lehnt bei diesem Zustand ab");
  assert.equal(snapshot.remainingCents, -384, "remainingCents liest jetzt die Gate-Groesse (1284), nicht die Lebenszeit (423)");
  const missing = reserveCents - snapshot.remainingCents;
  assert.equal(missing, 684);
  assert.ok(missing > 0, "der Fehlbetrag darf bei einer Ablehnung nie negativ sein");
});

// ---- T3: der Grund-Zweig von tenantReserveDenial folgt der Gate-Achse --------------

test("T3 Grund-Zweig: LIVE-Fixture liefert reserve_erschoepft (remainingCents <= 0), nicht reserve_ueber_rest", async () => {
  const denial = await runReserveBudgetGate(liveFixture(), FLAG_ON, 300);
  assert.equal(denial.audit.grund, "reserve_erschoepft");
});

// ---- T4: budgetExceeded und spentCents teilen die Achse ----------------------------

test("T4 budgetExceeded folgt derselben Achse wie snapshot.spentCents", () => {
  for (const { name, build, cfg } of FIXTURES) {
    const s = build();
    const snapshot = tenantBudgetSnapshot(s, TENANT, cfg, JULY_ISO);
    assert.equal(
      budgetExceeded(s, TENANT, cfg, JULY_ISO),
      snapshot.spentCents >= snapshot.capCents,
      `${name}: budgetExceeded und der Snapshot muessen dieselbe Verbrauchszahl gegen dieselbe Decke pruefen`,
    );
  }
});

// ---- T5: Spiegelfall des behobenen Fehlers (zweiseitiger Riegel an der Anzeige-Kante) --

// Ohne oeffentliche ops-API konstruierbar (Muster test/budget-month-flip.test.js
// stateWithUsage): ein einzelner vergifteter Bucket-Wert, NICHT ueber eine reale Buchung
// erzeugbar.
function stateWithUsage(tenantId, overrides) {
  const s = makeDefaultState();
  setTenantBudget(s, tenantId, { budgetCents: CAP_CENTS, hardCapCents: CAP_CENTS });
  s.usage[tenantId] = { ...emptyUsage(), ...overrides };
  return s;
}

test("T5 vergifteter Lebenszeit-Zaehler bei gesunder Gate-Groesse: Snapshot liefert null (nicht die Gate-Zahl)", () => {
  const s = stateWithUsage(TENANT, {
    costCents: NaN,
    spendMonthKey: "2026-07",
    spendMonthCostCents: 50,
  });
  const snapshot = tenantBudgetSnapshot(s, TENANT, FLAG_ON, JULY_ISO);
  assert.equal(snapshot.spentCents, null, "eine Fassung, die nur die Lesequelle wechselt (ohne den zweiseitigen Riegel), wuerde hier 50 liefern");
  assert.equal(snapshot.remainingCents, null);
});

test("T5b Gegenprobe: vergiftete Gate-Groesse bei gesundem Lebenszeit-Zaehler liefert ebenfalls null", () => {
  const s = stateWithUsage(TENANT, {
    costCents: 50,
    spendMonthKey: "2026-07",
    spendMonthCostCents: NaN,
  });
  const snapshot = tenantBudgetSnapshot(s, TENANT, FLAG_ON, JULY_ISO);
  assert.equal(snapshot.spentCents, null);
  assert.equal(snapshot.remainingCents, null);
});

// ---- T6: keine Log-Flut an der Anzeige-Kante ---------------------------------------

// Leitet console.error waehrend fn um (Muster test/budget-month-flip.test.js captureErr):
// restauriert IMMER, auch bei Wurf.
function captureErr(fn) {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.map(String).join(" "));
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return logs.join("\n");
}

test("T6 tenantBudgetSnapshot loggt NICHT bei einem vergifteten Bucket - budgetExceeded loggt weiterhin", () => {
  const s = stateWithUsage(TENANT, {
    costCents: NaN,
    spendMonthKey: "2026-07",
    spendMonthCostCents: 50,
  });
  const snapshotLog = captureErr(() => tenantBudgetSnapshot(s, TENANT, FLAG_ON, JULY_ISO));
  assert.equal(snapshotLog, "", "die Anzeige-Kante teilt den Riegel, aber nicht das Log (sonst Log-Flut bei /api/state)");

  const gateLog = captureErr(() => budgetExceeded(s, TENANT, FLAG_ON, JULY_ISO));
  assert.match(gateLog, /grund=usage_korrupt/, "die GATE-Kante loggt weiterhin (Gegenprobe: der Riegel selbst ist unveraendert)");
});

// ---- T7: Gate-Ebene, echte Ablehnungstexte -----------------------------------------

// Ops-gestuetzter Store-Adapter (statt konstanter Stubs): delegiert auf dieselbe s/NOW
// wie die Ops-Ebene oben, damit der Ablehnungstext exakt den echten Snapshot rendert.
function opsBackedStore(s, cfg, nowIso) {
  return {
    tenantLanguage: () => "de",
    budgetExceeded: (tenantId) => budgetExceeded(s, tenantId, cfg, nowIso),
    reserveExceedsBudget: (tenantId, reserveCents) => reserveExceedsBudget(s, tenantId, reserveCents, cfg, nowIso),
    tenantBudgetSnapshot: (tenantId) => tenantBudgetSnapshot(s, tenantId, cfg, nowIso),
    tryReserveOutboundBudget: () => false, // Fixturen dieser Datei liegen alle ueber der Decke
    withStoreLock: (fn) => fn(),
    claimPlatformSpendWarning: () => null,
  };
}

async function runReserveBudgetGate(s, cfg, reserveCents) {
  const { gates } = makeOutboundGates({
    store: opsBackedStore(s, cfg, JULY_ISO),
    config: withConfigNamespaces({ outboundFrozen: false, platformSpendCapCents: 800 }),
    requestTenant: () => "T",
    internalIdentity: () => null,
    OWNER_ID: "owner",
    TENANT_REJECT: "reject",
  });
  const gate = gates.find((g) => g.name === "reserve_budget");
  return gate.run({ to: "+491711234567", tenantId: TENANT, requestedBy: "owner", reserveCents });
}

test("T7 reserve_budget-Gate, LIVE-Fixture: 402, grund=reserve_erschoepft, KEIN negativer Betrag im Text", async () => {
  const denial = await runReserveBudgetGate(liveFixture(), FLAG_ON, 300);
  assert.equal(denial.status, 402);
  assert.equal(denial.audit.grund, "reserve_erschoepft");
  assert.ok(!NEGATIVE_AMOUNT.test(denial.body.error), `Ablehnungstext darf keinen negativen Betrag nennen: ${denial.body.error}`);
  assert.ok(!DURATION_LEAK.test(denial.body.error), "keine ausfuehrbare Dauer im Ablehnungstext (Vorgabe 4)");
});

// ---- T8: die "Getragene Kante" aus PLAN-SECURITY.md - zwei getrennte Fassaden-Uhren ---

// T1/T2 belegen die Invariante NUR bei identischem nowIso (ops-Ebene). An der
// Store-Fassade (json.js/pg.js) erzeugen reserveExceedsBudget und tenantBudgetSnapshot
// aber je ein EIGENES new Date().toISOString() - outbound-gates.js ruft zuerst
// reserveExceedsBudget (Uhr t1) und danach, bei Ablehnung, tenantBudgetSnapshot (Uhr
// t2 >= t1) auf. Rollt zwischen t1 und t2 der UTC-Spend-Monat, faellt spendMonthCostCents
// auf 0 und der Fehlbetrag kann NEGATIV werden - keine Lock-Verletzung, sondern die
// dokumentierte Grenze der Zusage (PLAN-SECURITY.md, Abschnitt KS-P4, "Getragene Kante").
// Diese Datei kann keine Fassaden-Uhr simulieren (nowIso ist an der ops-Ebene explizit),
// deshalb ruft der Test dieselben zwei ops-Funktionen mit den zwei GETRENNTEN nowIso auf,
// die eine reale Fassade in diesem Fenster liefern wuerde.
test("T8 divergierendes nowIso ueber eine Spend-Monat-Grenze: Fehlbetrag kann negativ werden (dokumentiertes Restrisiko)", () => {
  const s = stateWithUsage(TENANT, {
    costCents: 1284,
    spendMonthKey: "2026-07",
    spendMonthCostCents: 1284,
  });
  const t1 = "2026-07-31T23:59:59.999Z";
  const t2 = "2026-08-01T00:00:00.000Z";
  const reserveCents = 300;

  const gateDenies = reserveExceedsBudget(s, TENANT, reserveCents, FLAG_ON, t1);
  assert.equal(gateDenies, true, "Vorbedingung: das Gate lehnt bei t1 (noch im alten Spend-Monat) ab");

  const snapshotAfterRollover = tenantBudgetSnapshot(s, TENANT, FLAG_ON, t2);
  assert.equal(snapshotAfterRollover.spentCents, 0, "der Spend-Monat ist bei t2 bereits gerollt");
  assert.equal(snapshotAfterRollover.remainingCents, CAP_CENTS);

  const missing = reserveCents - snapshotAfterRollover.remainingCents;
  assert.equal(missing, -600, "der Ablehnungstext wuerde bei divergierenden Fassaden-Uhren einen negativen Fehlbetrag rendern");

  // Gegenprobe (T1-Invariante): bei IDENTISCHEM nowIso auf beiden Seiten bleibt der
  // Fehlbetrag konsistent zur Gate-Entscheidung - die Divergenz kommt ausschliesslich
  // aus den zwei getrennten Uhren, nicht aus der Snapshot-Logik selbst.
  const snapshotSameClock = tenantBudgetSnapshot(s, TENANT, FLAG_ON, t1);
  const missingSameClock = reserveCents - snapshotSameClock.remainingCents;
  assert.ok(missingSameClock > 0, "bei gleicher Uhr bleibt der Fehlbetrag konsistent zur Ablehnung");
});
