import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  makeDefaultState,
  usageFor,
  trackUsage,
  addVoiceUsageCostCents,
  budgetExceeded,
  reserveExceedsBudget,
  tryReserveOutboundBudget,
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

test("(d) pg-Hydrierung heilt cost_eur='NaN' fail-closed zu costCents=0, grund=usage_korrupt", async () => {
  const { store, db } = await makePgTestStore();
  store.trackUsage(BOOTSTRAP_TENANT_ID, tokensOf(1_000_000, 0), PRICES);
  await store.save();
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
  await db.query(`UPDATE usage SET cost_eur = 'NaN' WHERE tenant_id = $1`, [BOOTSTRAP_TENANT_ID]);

  let reopened;
  const out = await captureErr(async () => {
    reopened = await reopen(db);
  });

  assert.equal(reopened.usageOf(BOOTSTRAP_TENANT_ID).costCents, 0, "korrupter Bestand heilt zu 0");
  assert.match(out, new RegExp(`grund=${USAGE_CORRUPT_REASON}`));
});

test("geteilte Quelle: das alte !(x>=0)-Idiom ist aus state-ops.js/pg.js verschwunden", () => {
  const idiom = /!\(\s*[A-Za-z_$][\w$]*\s*>=\s*0\s*\)/;
  const stateOps = readFileSync(new URL("../src/store/state-ops.js", import.meta.url), "utf8");
  const pg = readFileSync(new URL("../src/store/pg.js", import.meta.url), "utf8");
  assert.equal(idiom.test(stateOps), false, "state-ops.js darf das Inline-Idiom nicht mehr enthalten");
  assert.equal(idiom.test(pg), false, "pg.js darf das Inline-Idiom nicht enthalten");
});
