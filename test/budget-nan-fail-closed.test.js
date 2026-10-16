import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  usageFor,
  trackUsage,
  addVoiceUsageCostCents,
  budgetExceeded,
  reserveExceedsBudget,
  tryReserveOutboundBudget,
  createCall,
  recordCallEstimatedCostCents,
  NO_CHARGE_ANCHORS,
  liveBudgetExceeded,
  releaseOutboundReserveCents,
  claimPlatformSpendWarning,
} from "../src/store/state-ops.js";
import { isBookableCents, USAGE_CORRUPT_REASON, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { makeMetering } from "../src/billing/metering.js";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore } from "./pg-helpers.js";
import { PRICES, tokensOf, tokensWithCache } from "./_prices.js";

const TENANT_A = "tenant_a";
const CAP_CENTS = PRICES.platformSpendCapCents;
const UNBOOKABLE = [NaN, Infinity, -Infinity, -1, -0.5, 0.5, "5", null, undefined];
const BOOKABLE = [0, 1, 250];
const STORED_USAGE_TOKENS = 1_000_000;
const FILLER_TOKENS = 10;
const FINITE_TOKENS_WITH_INFINITE_COST = 1e308;
const WARN_THRESHOLD_PERCENT = 80;
const LIFETIME_BUCKET_CENTS = 100;
const FRACTIONAL_PERIOD_BASELINE_CENTS = 99.5;
const FRACTIONAL_CENTS_ABOVE_CAP = CAP_CENTS + 0.5;

async function captureErr(fn) {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = orig;
  }
  return logs.join("\n");
}

async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

test("(a) reconcileVoiceBudget mit kaputtem endedAt bucht NICHT (Bucket bit-identisch)", () => {
  const s = makeDefaultState();
  addVoiceUsageCostCents(s, TENANT_A, 250);
  const fakeStore = { addVoiceUsageCostCents: (t, c) => addVoiceUsageCostCents(s, t, c) };
  const { reconcileVoiceBudget } = makeMetering({ store: fakeStore, config: {} });
  reconcileVoiceBudget({
    direction: "outbound",
    tenantId: TENANT_A,
    to: "+491701234567",
    answeredAt: "2026-01-01T00:00:00.000Z",
    endedAt: "kaputt",
  });
  assert.equal(usageFor(s, TENANT_A).costCents, 250, "kaputtes endedAt darf den Bucket nicht vergiften");
});

test("Wurzel: voiceMinutesOf normalisiert ein kaputtes answeredAt/endedAt auf 0 (nie NaN)", () => {
  const { voiceMinutesOf } = makeMetering({ store: {}, config: {} });
  const ok = "2026-01-01T00:00:00.000Z";
  assert.equal(voiceMinutesOf({ answeredAt: ok, endedAt: "kaputt" }), 0, "kaputtes endedAt -> 0");
  assert.equal(voiceMinutesOf({ answeredAt: "kaputt", endedAt: ok }), 0, "kaputtes answeredAt -> 0");
});

test("(b) budgetExceeded: NaN-Bucket sperrt fail-closed mit grund=usage_korrupt", async () => {
  const s = makeDefaultState();
  usageFor(s, TENANT_A).costCents = NaN;
  let result;
  const out = await captureErr(() => {
    result = budgetExceeded(s, TENANT_A, PRICES);
  });
  assert.equal(result, true, "NaN-Bucket muss sperren, nicht durchlassen");
  assert.match(out, new RegExp(`grund=${USAGE_CORRUPT_REASON}`));
});

test("(c) addVoiceUsageCostCents(NaN) verwirft, Bucket + Schwelle (800) bleiben intakt", () => {
  const s = makeDefaultState();
  addVoiceUsageCostCents(s, TENANT_A, 790);
  addVoiceUsageCostCents(s, TENANT_A, NaN);
  assert.equal(usageFor(s, TENANT_A).costCents, 790, "NaN-Schreibversuch aendert den Bucket nicht");
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), false, "790 < 800 -> noch frei");
  addVoiceUsageCostCents(s, TENANT_A, 10);
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), true, "800 >= 800 -> exceeded, Schwelle intakt");
});

test("trackUsage(NaN-Input) verwirft alles-oder-nichts, liefert BIT-IDENTISCH den Bucket zurueck", () => {
  const s = makeDefaultState();
  const before = { ...usageFor(s, TENANT_A) };
  const ret = trackUsage(s, TENANT_A, tokensOf(NaN, 0), PRICES);
  assert.deepEqual(usageFor(s, TENANT_A), before, "kein Teil-Schreibeffekt (weder Tokens noch Cents)");
  assert.equal(ret, usageFor(s, TENANT_A), "Rueckgabevertrag bleibt der Bucket");
});

test("B4A-D7-1: NaN in JEDER der vier Token-Sorten verwirft den Turn, Bucket bleibt bit-identisch", () => {
  for (const sorte of ["uncached", "cacheWrite", "cacheRead", "output"]) {
    const s = makeDefaultState();
    const before = { ...usageFor(s, TENANT_A) };
    trackUsage(s, TENANT_A, tokensWithCache({ uncached: 10, output: 10, [sorte]: NaN }), PRICES);
    assert.deepEqual(usageFor(s, TENANT_A), before, `NaN in ${sorte} muss den ganzen Turn verwerfen`);
  }
});

test("T5-Raender: UNBOOKABLE wird ueberall abgelehnt, BOOKABLE bleibt buchbar (0 inklusive)", () => {
  for (const val of UNBOOKABLE) {
    assert.equal(isBookableCents(val), false, `isBookableCents(${String(val)}) muss false sein`);
    const s = makeDefaultState();
    addVoiceUsageCostCents(s, TENANT_A, 100);
    addVoiceUsageCostCents(s, TENANT_A, val);
    assert.equal(
      usageFor(s, TENANT_A).costCents,
      100,
      `addVoiceUsageCostCents(${String(val)}) darf den Bucket nicht veraendern`,
    );
    assert.equal(
      tryReserveOutboundBudget(s, TENANT_A, val, PRICES),
      false,
      `tryReserveOutboundBudget(${String(val)}) muss ablehnen`,
    );
  }
  for (const val of BOOKABLE) {
    assert.equal(isBookableCents(val), true, `isBookableCents(${val}) muss true sein (P1-Safety-BLOCKER)`);
  }
});

test("Reserve-Lesekante: NaN-Bucket sperrt reserveExceedsBudget", async () => {
  const s = makeDefaultState();
  usageFor(s, TENANT_A).costCents = NaN;
  let a;
  const out = await captureErr(() => {
    a = reserveExceedsBudget(s, TENANT_A, 60, PRICES);
  });
  assert.equal(a, true, "reserveExceedsBudget muss bei NaN sperren, sonst wuerde reserviert");
  assert.match(out, new RegExp(`grund=${USAGE_CORRUPT_REASON}`));
});

test("G26-Regressionstest: fraktionaler Tenant-Bucket (0.5) sperrt budgetExceeded + reserveExceedsBudget fail-closed", async () => {
  const s = makeDefaultState();
  usageFor(s, TENANT_A).costCents = 0.5;
  let a, c;
  const out = await captureErr(() => {
    a = budgetExceeded(s, TENANT_A, PRICES);
    c = reserveExceedsBudget(s, TENANT_A, 60, PRICES);
  });
  assert.equal(a, true, "budgetExceeded muss bei fraktionalem Tenant-Bucket sperren");
  assert.equal(c, true, "reserveExceedsBudget muss bei fraktionalem Tenant-Bucket sperren");
  assert.match(out, new RegExp(`grund=${USAGE_CORRUPT_REASON}`));
});

async function hydrateWithCorruptCostEur(costEur) {
  const { store, db } = await makePgTestStore();
  store.trackUsage(BOOTSTRAP_TENANT_ID, tokensOf(STORED_USAGE_TOKENS, 0), PRICES);
  await store.save();
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
  await db.query(`UPDATE usage SET cost_eur = $2 WHERE tenant_id = $1`, [BOOTSTRAP_TENANT_ID, costEur]);
  let reopened;
  const out = await captureErr(async () => {
    reopened = await reopen(db);
  });
  return { reopened, out };
}

test("(d) pg-Hydrierung heilt cost_eur='NaN' fail-closed zu costCents=0, grund=usage_korrupt", async () => {
  const { reopened, out } = await hydrateWithCorruptCostEur("NaN");

  assert.equal(reopened.usageOf(BOOTSTRAP_TENANT_ID).costCents, 0, "korrupter Bestand heilt zu 0");
  assert.match(out, new RegExp(`grund=${USAGE_CORRUPT_REASON}`));
});

test("(e) Bruch-, Unendlich- und negative Werte verwirft jede Buchungskante, nicht nur NaN", () => {
  const numbers = UNBOOKABLE.filter((val) => typeof val === "number" && !Number.isNaN(val));
  for (const val of numbers) {
    for (const sorte of ["uncached", "cacheWrite", "cacheRead", "output"]) {
      const turnState = makeDefaultState();
      const before = { ...usageFor(turnState, TENANT_A) };
      const tokens = tokensWithCache({ uncached: FILLER_TOKENS, output: FILLER_TOKENS, [sorte]: val });
      trackUsage(turnState, TENANT_A, tokens, PRICES);
      assert.deepEqual(usageFor(turnState, TENANT_A), before, `${String(val)} in ${sorte} muss den ganzen Turn verwerfen`);
    }
    const callState = makeDefaultState();
    const call = createCall(callState, { direction: "outbound", from: "+15005550006", to: "+4930123456", tenantId: TENANT_A });
    const { changed } = recordCallEstimatedCostCents(callState, call.id, { costCents: val, chargeAnchors: NO_CHARGE_ANCHORS });
    assert.equal(changed, false, `recordCallEstimatedCostCents(${String(val)}) muss ablehnen`);
    assert.equal(call.estimatedCostCents, null, `geschaetzte Kosten bleiben leer bei ${String(val)}`);
  }
  const infiniteCostState = makeDefaultState();
  const before = { ...usageFor(infiniteCostState, TENANT_A) };
  trackUsage(infiniteCostState, TENANT_A, tokensOf(FINITE_TOKENS_WITH_INFINITE_COST, 0), PRICES);
  assert.deepEqual(usageFor(infiniteCostState, TENANT_A), before, "unendliche Kosten aus endlichen Tokens verwerfen den Turn");
});

test("(f) pg-Hydrierung heilt cost_eur='Infinity' fail-closed zu costCents=0, grund=usage_korrupt", async () => {
  const { reopened, out } = await hydrateWithCorruptCostEur("Infinity");

  assert.equal(reopened.usageOf(BOOTSTRAP_TENANT_ID).costCents, 0, "unendlicher Bestand heilt zu 0");
  assert.match(out, new RegExp(`grund=${USAGE_CORRUPT_REASON}`));
});

test("(g) Bruch-, Unendlich- und negative Werte sperren auch Live-Kosten, Perioden- und Monatsachse, Reserve-Freigabe und Plattform-Warnung", async () => {
  const monthCfg = { ...PRICES, budgetMonthEnabled: true };
  const warnCfg = { ...PRICES, platformSpendWarnPercent: WARN_THRESHOLD_PERCENT };
  const reached = makeDefaultState();
  reached.reservations[TENANT_A] = CAP_CENTS;
  assert.notEqual(claimPlatformSpendWarning(reached, warnCfg), null, "Positiv-Kontrolle: volle Reserve warnt");
  for (const val of UNBOOKABLE.filter((candidate) => typeof candidate === "number")) {
    const live = makeDefaultState();
    assert.equal(liveBudgetExceeded(live, TENANT_A, val, PRICES), true, `Live-Kosten ${String(val)} sperren`);
    assert.equal(releaseOutboundReserveCents(live, TENANT_A, val), false, `Freigabe ${String(val)} wird verworfen`);
    usageFor(live, TENANT_A).costCents = val;
    assert.equal(budgetExceeded(live, TENANT_A, monthCfg), true, `Lebenszeit-Bucket ${String(val)} sperrt die Monatsachse`);
    const platform = makeDefaultState();
    platform.reservations[TENANT_A] = val;
    assert.equal(claimPlatformSpendWarning(platform, warnCfg), null, `Reserve ${String(val)} loest keine Warnung aus`);
  }
  const aboveCap = makeDefaultState();
  aboveCap.reservations[TENANT_A] = FRACTIONAL_CENTS_ABOVE_CAP;
  assert.equal(claimPlatformSpendWarning(aboveCap, warnCfg), null, "Bruchwert oberhalb der Warnschwelle loest keine Warnung aus");
  const period = makeDefaultState();
  Object.assign(usageFor(period, TENANT_A), {
    costCents: LIFETIME_BUCKET_CENTS,
    budgetPeriodKey: "p1",
    budgetPeriodBaselineCents: FRACTIONAL_PERIOD_BASELINE_CENTS,
  });
  let periodDenied;
  const out = await captureErr(() => {
    periodDenied = budgetExceeded(period, TENANT_A, PRICES);
  });
  assert.equal(periodDenied, true, "gebrochene Periodenachse (0.5) sperrt trotz ganzzahligem Lebenszeit-Bucket");
  assert.match(out, /feld=gateCents wert=0\.5/, "die Meldung nennt die kaputte Achse");
});
