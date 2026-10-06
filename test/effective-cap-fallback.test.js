import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  addVoiceUsageCostCents,
  budgetExceeded,
  reserveExceedsBudget,
  setTenantBudget,
  tenantBudgetSnapshot,
  usageFor,
  tryReserveOutboundBudget,
} from "../src/store/state-ops.js";

const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";

const PLATFORM_CAP_CENTS = 1200;
const TENANT_DEFAULT_CENTS = 1000;
const NO_TENANT_DEFAULT = 0;
const DOMESTIC_RESERVE_CENTS = 60;

const CFG_WITH_DEFAULT = Object.freeze({
  platformSpendCapCents: PLATFORM_CAP_CENTS,
  defaultTenantBudgetCents: TENANT_DEFAULT_CENTS,
});
const CFG_SENTINEL_ZERO = Object.freeze({
  platformSpendCapCents: PLATFORM_CAP_CENTS,
  defaultTenantBudgetCents: NO_TENANT_DEFAULT,
});

test("0-Sentinel: defaultTenantBudgetCents=0 -> Cap bleibt der Plattform-Cap", () => {
  const s = makeDefaultState();
  assert.equal(
    budgetExceeded(s, TENANT_A, CFG_SENTINEL_ZERO),
    false,
    "unverbrauchter Tenant ist NIE gesperrt (ein 0-Cap waere Totalausfall der Telefonie)",
  );
  assert.equal(
    reserveExceedsBudget(s, TENANT_A, DOMESTIC_RESERVE_CENTS, CFG_SENTINEL_ZERO),
    false,
    "normale Inlands-Reserve geht durch",
  );
  addVoiceUsageCostCents(s, TENANT_A, PLATFORM_CAP_CENTS - 1);
  assert.equal(budgetExceeded(s, TENANT_A, CFG_SENTINEL_ZERO), false, "1199 < 1200 -> frei");
  addVoiceUsageCostCents(s, TENANT_A, 1);
  assert.equal(budgetExceeded(s, TENANT_A, CFG_SENTINEL_ZERO), true, "1200 >= 1200 -> gesperrt");
});

test("Fallback (P2a): ohne tenant_budget-Zeile bindet die Tenant-Default-Decke", () => {
  const s = makeDefaultState();
  addVoiceUsageCostCents(s, TENANT_A, TENANT_DEFAULT_CENTS - 1);
  assert.equal(budgetExceeded(s, TENANT_A, CFG_WITH_DEFAULT), false, "999 < 1000 -> frei");
  addVoiceUsageCostCents(s, TENANT_A, 1);
  assert.equal(
    budgetExceeded(s, TENANT_A, CFG_WITH_DEFAULT),
    true,
    "1000 >= 1000 -> an der EIGENEN Decke gesperrt (vor P2a erst am Plattform-Topf 1200)",
  );
});

test("Cross-Tenant (P2a): B wird an SEINER Decke gemessen, nicht am geteilten Topf", () => {
  const s = makeDefaultState();
  addVoiceUsageCostCents(s, TENANT_A, 900);
  assert.equal(budgetExceeded(s, TENANT_B, CFG_WITH_DEFAULT), false, "B unverbraucht -> frei");
  assert.equal(
    reserveExceedsBudget(s, TENANT_B, DOMESTIC_RESERVE_CENTS, CFG_WITH_DEFAULT),
    false,
    "B telefoniert normal weiter, obwohl A 900 Cent haelt",
  );
  assert.equal(
    reserveExceedsBudget(s, TENANT_B, TENANT_DEFAULT_CENTS + 1, CFG_WITH_DEFAULT),
    true,
    "1001 > 1000 -> an der eigenen Decke gestoppt (vor P2a durfte B bis 1200 des GETEILTEN Topfes reservieren)",
  );
});

test("Praezedenz: eine tenant_budget-Zeile schlaegt die Default-Decke", () => {
  const s = makeDefaultState();
  const ROW_CAP_CENTS = 500;
  setTenantBudget(s, TENANT_A, { budgetCents: ROW_CAP_CENTS, hardCapCents: ROW_CAP_CENTS });
  addVoiceUsageCostCents(s, TENANT_A, ROW_CAP_CENTS - 1);
  assert.equal(budgetExceeded(s, TENANT_A, CFG_WITH_DEFAULT), false, "499 < 500 -> frei");
  addVoiceUsageCostCents(s, TENANT_A, 1);
  assert.equal(
    budgetExceeded(s, TENANT_A, CFG_WITH_DEFAULT),
    true,
    "Zeile (500) gewinnt gegen Default (1000) und gegen Plattform (1200)",
  );
});

test("cfg ohne defaultTenantBudgetCents -> Plattform-Cap (byte-identisch zum Bestand)", () => {
  const s = makeDefaultState();
  const CFG_OHNE_FELD = Object.freeze({ platformSpendCapCents: PLATFORM_CAP_CENTS });
  assert.equal(budgetExceeded(s, TENANT_A, CFG_OHNE_FELD), false, "leerer Bucket -> frei, kein 0-Cap");
  addVoiceUsageCostCents(s, TENANT_A, PLATFORM_CAP_CENTS - 1);
  assert.equal(budgetExceeded(s, TENANT_A, CFG_OHNE_FELD), false, "1199 < 1200 -> frei");
  addVoiceUsageCostCents(s, TENANT_A, 1);
  assert.equal(budgetExceeded(s, TENANT_A, CFG_OHNE_FELD), true, "1200 >= 1200 -> gesperrt");
});

test("tenantBudgetSnapshot: Praezedenz Zeile > Default > 0-Sentinel-Plattform, gleiche Werte wie die Gate-Praedikate", () => {
  const s = makeDefaultState();
  assert.deepEqual(
    tenantBudgetSnapshot(s, TENANT_A, CFG_SENTINEL_ZERO),
    { capCents: PLATFORM_CAP_CENTS, spentCents: 0, remainingCents: PLATFORM_CAP_CENTS },
    "0-Sentinel -> Cap ist der Plattform-Cap, unverbrauchter Bucket",
  );
  assert.deepEqual(
    tenantBudgetSnapshot(s, TENANT_A, CFG_WITH_DEFAULT),
    { capCents: TENANT_DEFAULT_CENTS, spentCents: 0, remainingCents: TENANT_DEFAULT_CENTS },
    "Default-Decke bindet ohne tenant_budget-Zeile",
  );
  const ROW_CAP_CENTS = 500;
  setTenantBudget(s, TENANT_A, { budgetCents: ROW_CAP_CENTS, hardCapCents: ROW_CAP_CENTS });
  addVoiceUsageCostCents(s, TENANT_A, 120);
  assert.deepEqual(
    tenantBudgetSnapshot(s, TENANT_A, CFG_WITH_DEFAULT),
    { capCents: ROW_CAP_CENTS, spentCents: 120, remainingCents: ROW_CAP_CENTS - 120 },
    "eine tenant_budget-Zeile gewinnt gegen die Default-Decke - dieselbe Praezedenz wie budgetExceeded",
  );
});

test("tenantBudgetSnapshot: remainingCents zieht die In-Flight-Reserve ab (reservationFor)", () => {
  const s = makeDefaultState();
  addVoiceUsageCostCents(s, TENANT_A, 100);
  assert.equal(
    tryReserveOutboundBudget(s, TENANT_A, DOMESTIC_RESERVE_CENTS, CFG_WITH_DEFAULT),
    true,
    "Vorbedingung: die Reserve muss tatsaechlich gebucht werden",
  );
  const snapshot = tenantBudgetSnapshot(s, TENANT_A, CFG_WITH_DEFAULT);
  assert.equal(snapshot.capCents, TENANT_DEFAULT_CENTS);
  assert.equal(snapshot.spentCents, 100, "settled Verbrauch bleibt unangetastet von der Reserve");
  assert.equal(
    snapshot.remainingCents,
    TENANT_DEFAULT_CENTS - 100 - DOMESTIC_RESERVE_CENTS,
    "der freie Rest schliesst die laufende In-Flight-Reserve ein, wie reserveExceedsBudget es tut",
  );
});

test("tenantBudgetSnapshot: unbuchbarer Bucket (D7) -> spentCents/remainingCents === null, capCents bleibt lesbar", () => {
  const s = makeDefaultState();
  usageFor(s, TENANT_A).costCents = NaN;
  const snapshot = tenantBudgetSnapshot(s, TENANT_A, CFG_WITH_DEFAULT);
  assert.equal(snapshot.capCents, TENANT_DEFAULT_CENTS, "die Decke selbst ist unabhaengig vom vergifteten Bucket lesbar");
  assert.equal(snapshot.spentCents, null, "kein Ist-Verbrauch gerendert - 'NaN EUR' waere eine Falschauskunft");
  assert.equal(snapshot.remainingCents, null, "kein freier Rest gerendert (D7)");
});
