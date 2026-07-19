// P2a (D3): effectiveCapCents faellt ohne tenant_budget-Zeile auf die TENANT-Default-Decke
// statt auf den geteilten Plattform-Topf. Rein ueber state-ops (kein Netz, kein Server,
// kein pglite - Lehre P6a: state-ops-Unit NICHT mit Spawn/pglite mischen).
//
// effectiveCapCents ist modul-privat und BLEIBT es (kein Export nur fuer den Test). Der
// jeweils geltende Cap wird ueber die beiden oeffentlichen Leser budgetExceeded /
// reserveExceedsBudget an seiner exakten Grenze abgetastet (cap-1 frei, cap gesperrt) -
// das nagelt den Wert eindeutig fest, wie schon in tenant-budget-cap.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  addVoiceUsageCostCents,
  budgetExceeded,
  reserveExceedsBudget,
  setTenantBudget,
} from "../src/store/state-ops.js";

const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";

// Plattform-Notaus der Fixture bewusst UEBER der Tenant-Decke - nur dann ist ueberhaupt
// unterscheidbar, WELCHE der beiden Achsen den Cap stellt.
const PLATFORM_CAP_CENTS = 1200;
const TENANT_DEFAULT_CENTS = 1000;
// Dokumentierter Sentinel "kein Default" (config.js defaultTenantBudgetCents, min 0).
const NO_TENANT_DEFAULT = 0;
// Worst-Case-Reserve eines Inlandsgespraechs: 20 ct/min * ceil(180 s / 60 s).
const DOMESTIC_RESERVE_CENTS = 60;

const CFG_WITH_DEFAULT = Object.freeze({
  maxBudgetCents: PLATFORM_CAP_CENTS,
  defaultTenantBudgetCents: TENANT_DEFAULT_CENTS,
});
const CFG_SENTINEL_ZERO = Object.freeze({
  maxBudgetCents: PLATFORM_CAP_CENTS,
  defaultTenantBudgetCents: NO_TENANT_DEFAULT,
});

// ---- (1) PFLICHT-REGRESSION: der 0-Sentinel. Muss VOR und NACH dem Fix gruen sein. ----
// Ein bedingungsloser Fallback lieferte hier Cap 0 -> jeder Tenant sofort gesperrt:
// kein Outbound, kein kostenloser Inbound, laufende Calls legen auf. Safety-Blocker.
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
  // Grenzabtastung: Cap ist exakt 1200 - weder 0 noch 1000.
  addVoiceUsageCostCents(s, TENANT_A, PLATFORM_CAP_CENTS - 1);
  assert.equal(budgetExceeded(s, TENANT_A, CFG_SENTINEL_ZERO), false, "1199 < 1200 -> frei");
  addVoiceUsageCostCents(s, TENANT_A, 1);
  assert.equal(budgetExceeded(s, TENANT_A, CFG_SENTINEL_ZERO), true, "1200 >= 1200 -> gesperrt");
});

// ---- (2) ROT VOR FIX: der Fallback bindet an der eigenen Decke, nicht am Topf. ----
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

// ---- (3) ROT VOR FIX: ein Tenant kann den Plattform-Topf nicht mehr allein leerreservieren.
// Die ersten beiden Assertions sind schon heute wahr und sind der Isolations-Regressions-
// anker (A's Verbrauch darf B nie unter B's eigener Decke blocken); die dritte ist der
// eigentliche P2a-Effekt und heute rot.
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

// ---- (4) Praezedenz unveraendert (gruen vor und nach dem Fix). ----
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

// ---- (5) Bestandsschutz: ein cfg OHNE das Feld darf nie einen 0-Cap ergeben. ----
// Pinnt zugleich, WARUM die uebrige Suite unveraendert gruen bleibt (PRICES & Co. tragen
// das Feld nicht) - ohne diesen Test waere das eine unbelegte Annahme.
test("cfg ohne defaultTenantBudgetCents -> Plattform-Cap (byte-identisch zum Bestand)", () => {
  const s = makeDefaultState();
  const CFG_OHNE_FELD = Object.freeze({ maxBudgetCents: PLATFORM_CAP_CENTS });
  assert.equal(budgetExceeded(s, TENANT_A, CFG_OHNE_FELD), false, "leerer Bucket -> frei, kein 0-Cap");
  addVoiceUsageCostCents(s, TENANT_A, PLATFORM_CAP_CENTS - 1);
  assert.equal(budgetExceeded(s, TENANT_A, CFG_OHNE_FELD), false, "1199 < 1200 -> frei");
  addVoiceUsageCostCents(s, TENANT_A, 1);
  assert.equal(budgetExceeded(s, TENANT_A, CFG_OHNE_FELD), true, "1200 >= 1200 -> gesperrt");
});
