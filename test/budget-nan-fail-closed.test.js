// D7 (PLAN-BUDGET-AXES P1): ein nicht-endlicher/negativer Geldwert darf weder in einen
// Bucket gelangen (Schreibkante) noch ein Gate blind machen (Lesekante) noch einen
// vergifteten Bestand ueber den Boot tragen (Hydrierungskante). Wurzel ist voiceMinutesOf.
// Alle Faelle sind VOR dem Fix rot. Kein Netz, kein Server (F.I.R.S.T.), ein pglite-Fall
// fuer die Hydrierung (Postgres-in-WASM, offline).
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
  globalBudgetExceeded,
  reserveExceedsBudget,
  globalReserveExceedsBudget,
  tryReserveOutboundBudget,
} from "../src/store/state-ops.js";
import { isBookableCents, USAGE_CORRUPT_REASON, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { makeMetering } from "../src/billing/metering.js";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore } from "./pg-helpers.js";
import { PRICES, tokensOf } from "./_prices.js";

const TENANT_A = "tenant_a";
const CAP_CENTS = PRICES.maxBudgetCents; // 800
const UNBOOKABLE = [NaN, Infinity, -Infinity, -1, -0.5, "5", null, undefined];
const BOOKABLE = [0, 1, 250, 0.5];

// Leitet console.error waehrend fn um (Muster test/boot-guard.test.js captureErrAsync):
// restauriert IMMER, auch bei Wurf. fn darf sync oder async sein.
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

// Baut auf einer BESTEHENDEN pglite-Instanz einen frischen Store (Muster reopen() aus
// test/store-pg.test.js) - re-hydriert den Spiegel aus der DB statt nur In-Memory zu pruefen.
async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

// ---- (a)+Wurzel: metering.voiceMinutesOf / reconcileOutboundVoiceBudget ----

test("(a) reconcileOutboundVoiceBudget mit kaputtem endedAt bucht NICHT (Bucket bit-identisch)", () => {
  const s = makeDefaultState();
  addVoiceUsageCostCents(s, TENANT_A, 250); // vorbelegter Bucket
  const fakeStore = { addVoiceUsageCostCents: (t, c) => addVoiceUsageCostCents(s, t, c) };
  const { reconcileOutboundVoiceBudget } = makeMetering({ store: fakeStore, config: {} });
  reconcileOutboundVoiceBudget({
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

// ---- (b) Lesekanten: budgetExceeded / globalBudgetExceeded ----

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

test("(b') globalBudgetExceeded: NaN-Bucket sperrt fail-closed mit grund=usage_korrupt", async () => {
  const s = makeDefaultState();
  usageFor(s, TENANT_A).costCents = NaN;
  let result;
  const out = await captureErr(() => {
    result = globalBudgetExceeded(s, PRICES);
  });
  assert.equal(result, true, "vergifteter Tenant-Bucket macht die Plattform-Summe NaN -> sperren");
  assert.match(out, new RegExp(`grund=${USAGE_CORRUPT_REASON}`));
});

// ---- (c) Schwelle bleibt intakt: ein verworfener NaN-Schreibversuch aendert den Bucket nicht ----

test("(c) addVoiceUsageCostCents(NaN) verwirft, Bucket + Schwelle (800) bleiben intakt", () => {
  const s = makeDefaultState();
  addVoiceUsageCostCents(s, TENANT_A, 790);
  addVoiceUsageCostCents(s, TENANT_A, NaN); // muss verworfen werden
  assert.equal(usageFor(s, TENANT_A).costCents, 790, "NaN-Schreibversuch aendert den Bucket nicht");
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), false, "790 < 800 -> noch frei");
  addVoiceUsageCostCents(s, TENANT_A, 10); // -> 800
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), true, "800 >= 800 -> exceeded, Schwelle intakt");
});

// ---- Schreibkante: trackUsage verwirft VOR jeder Mutation (alles-oder-nichts) ----

test("trackUsage(NaN-Input) verwirft alles-oder-nichts, liefert BIT-IDENTISCH den Bucket zurueck", () => {
  const s = makeDefaultState();
  const before = { ...usageFor(s, TENANT_A) };
  const ret = trackUsage(s, TENANT_A, tokensOf(NaN, 0), PRICES);
  assert.deepEqual(usageFor(s, TENANT_A), before, "kein Teil-Schreibeffekt (weder Tokens noch Cents)");
  assert.equal(ret, usageFor(s, TENANT_A), "Rueckgabevertrag bleibt der Bucket");
});

// ---- T5-Raender: isBookableCents + die Schreib-/Reserve-Kanten je Randwert ----

test("T5-Raender: UNBOOKABLE wird ueberall abgelehnt, BOOKABLE bleibt buchbar (0/0.5 inklusive)", () => {
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

// ---- Reserve-Lesekanten (Zusatzbefund D-3) ----

test("Reserve-Lesekanten: NaN-Bucket sperrt reserveExceedsBudget + globalReserveExceedsBudget", async () => {
  const s = makeDefaultState();
  usageFor(s, TENANT_A).costCents = NaN;
  let a, b;
  const out = await captureErr(() => {
    a = reserveExceedsBudget(s, TENANT_A, 60, PRICES);
    b = globalReserveExceedsBudget(s, 60, PRICES);
  });
  assert.equal(a, true, "reserveExceedsBudget muss bei NaN sperren, sonst wuerde reserviert");
  assert.equal(b, true, "globalReserveExceedsBudget muss bei NaN sperren");
  assert.match(out, new RegExp(`grund=${USAGE_CORRUPT_REASON}`));
});

// ---- (d) Hydrierungskante: pg rowToUsage heilt einen korrupten cost_eur='NaN'-Bestand ----

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

// ---- Geteilte Quelle: das alte Inline-Idiom darf nicht zurueckkehren (Pre-Mortem (3)) ----

test("geteilte Quelle: das alte !(x>=0)-Idiom ist aus state-ops.js/pg.js verschwunden", () => {
  const idiom = /!\(\s*[A-Za-z_$][\w$]*\s*>=\s*0\s*\)/;
  const stateOps = readFileSync(new URL("../src/store/state-ops.js", import.meta.url), "utf8");
  const pg = readFileSync(new URL("../src/store/pg.js", import.meta.url), "utf8");
  assert.equal(idiom.test(stateOps), false, "state-ops.js darf das Inline-Idiom nicht mehr enthalten");
  assert.equal(idiom.test(pg), false, "pg.js darf das Inline-Idiom nicht enthalten");
});
