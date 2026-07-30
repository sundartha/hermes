// KS-P9/E10: die Plattform-Geldachse verliert die SPERRWIRKUNG und behaelt nur noch
// Messung + Warnschwelle. Diese Datei ist das Regressionsschloss dafuer, auf zwei Ebenen:
//   - Ops-Ebene (state-ops): zwei Tenants unter ihren eigenen Decken duerfen telefonieren,
//     auch wenn ihre SUMME die Plattform-Zahl weit reisst - und die Beobachtung sieht
//     dieselbe Summe trotzdem.
//   - Gate-Ebene (outbound-gates): die Kette kommt OHNE eine globalBudgetExceeded-Methode
//     am Store aus (keine Kontraktflaeche mehr), waehrend die Tenant-Achse scharf bleibt.
// Reine Unit-Ebene, offline, kein Spawn, kein Store-Singleton (F.I.R.S.T.).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as stateOps from "../src/store/state-ops.js";
import {
  makeDefaultState,
  addVoiceUsageCostCents,
  budgetExceeded,
  tryReserveOutboundBudget,
  reservationFor,
  claimPlatformSpendWarning,
  setTenantBudget,
} from "../src/store/state-ops.js";
import { makeOutboundGates } from "../src/telephony/outbound-gates.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

// Die Store-Fassade wird DYNAMISCH geladen, nachdem DATA_DIR auf ein Temp-Verzeichnis
// zeigt (Muster test/store-backend-parity.test.js): sonst haengt json.FILE an der echten
// data/store.json. Nur Struktur wird gelesen, kein Zustand.
let storeFacade;

before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-ks-p9-"));
  await import("../src/config.js");
  storeFacade = await import("../src/store.js");
});

const TENANT_A = "ks_p9_tenant_a";
const TENANT_B = "ks_p9_tenant_b";
// Jeder Tenant hat 1000 ct eigene Decke; die Plattform-"Zahl" liegt bei 1200 ct. Zwei
// Tenants mit je 900 ct Verbrauch reissen die Summe (1800 > 1200), bleiben aber JEDER
// unter seiner eigenen Decke.
const TENANT_CAP_CENTS = 1000;
const PLATFORM_CENTS = 1200;
const SPENT_PER_TENANT_CENTS = 900;
const RESERVE_CENTS = 50;
const JULY_ISO = "2026-07-15T10:00:00.000Z";

const CFG = {
  platformSpendCapCents: PLATFORM_CENTS,
  defaultTenantBudgetCents: 0, // Sentinel: die gesetzten Zeilen unten sind die Decke
  budgetMonthEnabled: false,
  platformSpendWarnPercent: 80,
};

// Build (P13): zwei Tenants mit eigener Decke, jeder unter seiner Decke, Summe weit
// ueber der Plattform-Zahl, KEINE Reserve gebucht.
function stateWithTwoTenantsOverPlatformSum() {
  const s = makeDefaultState();
  for (const tenantId of [TENANT_A, TENANT_B]) {
    setTenantBudget(s, tenantId, { budgetCents: TENANT_CAP_CENTS, hardCapCents: TENANT_CAP_CENTS });
    addVoiceUsageCostCents(s, tenantId, SPENT_PER_TENANT_CENTS);
  }
  return s;
}

// ---- (1) Mutationsprobe: die Plattform-Summe sperrt nicht mehr ---------------------

test("KS-P9 (1): Summe weit ueber der Plattform-Zahl - beide Tenants bleiben frei und duerfen reservieren", () => {
  const s = stateWithTwoTenantsOverPlatformSum();
  assert.equal(
    stateOps.gatePlatformUsageCents(s, CFG, JULY_ISO),
    2 * SPENT_PER_TENANT_CENTS,
    "Vorbedingung: die Plattform-Summe (1800) liegt weit ueber der Plattform-Zahl (1200)",
  );
  assert.equal(budgetExceeded(s, TENANT_A, CFG, JULY_ISO), false, "A unter der EIGENEN Decke -> frei");
  assert.equal(budgetExceeded(s, TENANT_B, CFG, JULY_ISO), false, "B unter der EIGENEN Decke -> frei");
  assert.equal(
    tryReserveOutboundBudget(s, TENANT_A, RESERVE_CENTS, CFG, JULY_ISO),
    true,
    "die Plattform-Summe lehnt die Reserve nicht mehr ab",
  );
  assert.equal(reservationFor(s, TENANT_A), RESERVE_CENTS, "Reserve wurde tatsaechlich gebucht");
});

test("KS-P9 (1b): die EIGENE Tenant-Decke sperrt unveraendert (Gegenprobe zur Mutationsprobe)", () => {
  const s = stateWithTwoTenantsOverPlatformSum();
  addVoiceUsageCostCents(s, TENANT_A, TENANT_CAP_CENTS - SPENT_PER_TENANT_CENTS); // A exakt auf seiner Decke
  assert.equal(budgetExceeded(s, TENANT_A, CFG, JULY_ISO), true, "eigene Decke erreicht -> gesperrt");
  assert.equal(tryReserveOutboundBudget(s, TENANT_A, RESERVE_CENTS, CFG, JULY_ISO), false);
  assert.equal(reservationFor(s, TENANT_A), 0, "abgelehnte Reserve hinterlaesst keinen Schreibeffekt");
  assert.equal(budgetExceeded(s, TENANT_B, CFG, JULY_ISO), false, "B ist von A's Sperre unberuehrt");
});

// ---- (2) Die Beobachtung lebt weiter ----------------------------------------------

test("KS-P9 (2): die Plattform-Warnung sieht dieselbe Summe inkl. In-Flight-Reserve, genau einmal je Spend-Monat", () => {
  const s = stateWithTwoTenantsOverPlatformSum();
  assert.equal(tryReserveOutboundBudget(s, TENANT_A, RESERVE_CENTS, CFG, JULY_ISO), true);
  const warning = claimPlatformSpendWarning(s, CFG, JULY_ISO);
  assert.deepEqual(
    warning,
    { totalCents: 2 * SPENT_PER_TENANT_CENTS + RESERVE_CENTS, monthKey: "2026-07" },
    "Gate-Verbrauch der Plattform + frisch gebuchte In-Flight-Reserve",
  );
  assert.equal(claimPlatformSpendWarning(s, CFG, JULY_ISO), null, "zweiter Aufruf im selben Spend-Monat: stumm");
});

// ---- (3) Strukturelles Regressionsschloss (Modul-Exporte, kein Text-Scan) ----------

test("KS-P9 (3): die Sperrpraedikate der Plattform-Achse sind aus state-ops und der Store-Fassade verschwunden", () => {
  const opsExports = Object.keys(stateOps);
  for (const name of ["globalBudgetExceeded", "globalReserveExceedsBudget"]) {
    assert.equal(opsExports.includes(name), false, `state-ops exportiert ${name} nicht mehr`);
    assert.equal(name in storeFacade, false, `die Store-Fassade traegt ${name} nicht mehr`);
  }
  // Gegenprobe: die BEOBACHTUNG haengt weiter an der Fassade (sonst waere zu viel entfallen).
  assert.equal(typeof storeFacade.claimPlatformSpendWarning, "function");
});

// ---- (4)/(5) Gate-Kette: keine Plattform-Kontraktflaeche mehr, Tenant-Achse scharf --

// Vollstaendig durchgesteuerter Fake OHNE globalBudgetExceeded-Methode (Muster
// test/deny-diagnosability.test.js): ein Rest-Aufruf wuerde hier als TypeError auffallen.
function gatesWithStore(storeOverrides = {}) {
  return makeOutboundGates({
    store: {
      tenantLanguage: () => "de",
      budgetExceeded: () => false,
      tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 350, remainingCents: 650 }),
      tryReserveOutboundBudget: () => true,
      reserveExceedsBudget: () => false,
      withStoreLock: (fn) => fn(),
      claimPlatformSpendWarning: () => null,
      ...storeOverrides,
    },
    config: withConfigNamespaces({ outboundFrozen: false, platformSpendCapCents: PLATFORM_CENTS }),
    requestTenant: () => "T",
    internalIdentity: () => null,
    OWNER_ID: "owner",
    TENANT_REJECT: "reject",
  }).gates;
}

const gateBy = (gates, name) => gates.find((g) => g.name === name);
const baseCtx = (overrides = {}) => ({ to: "+491711234567", tenantId: "T", requestedBy: "owner", ...overrides });

test("KS-P9 (4): das budget-Glied laeuft ohne globalBudgetExceeded-Methode am Store durch", async () => {
  const denial = await gateBy(gatesWithStore(), "budget").run(baseCtx());
  assert.equal(denial, null, "kein Denial und kein TypeError - die Plattform-Kontraktflaeche ist weg");
});

test("KS-P9 (5): das budget-Glied bleibt auf der Tenant-Achse scharf (402, grund=budget_tenant)", async () => {
  const denial = await gateBy(gatesWithStore({ budgetExceeded: () => true }), "budget").run(baseCtx());
  assert.equal(denial.status, 402);
  assert.equal(denial.audit.grund, "budget_tenant");
  assert.equal(denial.audit.detail, "to=+491711234567 grund=budget_tenant tenant=T");
});
