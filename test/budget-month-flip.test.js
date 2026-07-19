// P7 (PLAN-BUDGET-AXES): Der Flip - die vier Gate-Praedikate (budgetExceeded/
// reserveExceedsBudget/globalBudgetExceeded/globalReserveExceedsBudget) lesen den
// Verbrauch ueber die zwei Aufloesungsfunktionen gateUsageCents/gatePlatformUsageCents.
// Hinter cfg.budgetMonthEnabled (Default AUS = Bestand): AN misst BEIDE Achsen im
// UTC-Kalendermonat statt im Lebenszeit-Zaehler costCents.
//
// Alle Faelle sind VOR der Implementierung rot: der Import von gateUsageCents/
// gatePlatformUsageCents aus state-ops.js wirft (die Funktionen existieren noch nicht).
// Ops-Ebene, offline, kein Netz, kein Server-Spawn (F.I.R.S.T., Muster
// test/usage-spend-month-axis.test.js + test/platform-spend-warning.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  makeDefaultState,
  usageFor,
  addVoiceUsageCostCents,
  gateUsageCents,
  budgetExceeded,
  reserveExceedsBudget,
  globalBudgetExceeded,
  globalReserveExceedsBudget,
  tryReserveOutboundBudget,
  claimPlatformSpendWarning,
} from "../src/store/state-ops.js";
import { emptyUsage } from "../src/store/defaults.js";
import { config } from "../src/config.js";
import { PRICES } from "./_prices.js";

const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";

// Schluessel-Anker (UTC-Kalendermonat, s. state-ops.js spendMonthKeyOf).
const JULY_ISO = "2026-07-19T10:00:00.000Z"; // Schluessel '2026-07' (laufender Monat)
const AUGUST_ISO = "2026-08-05T00:00:00.000Z"; // Schluessel '2026-08' (Folgemonat ggue. JULY_ISO)

const FLAG_ON = { ...PRICES, budgetMonthEnabled: true };
const FLAG_OFF = PRICES; // budgetMonthEnabled fehlt -> falsy -> AUS (Bestandsverhalten)

function stateWithUsage(tenantId, overrides) {
  const s = makeDefaultState();
  s.usage[tenantId] = { ...emptyUsage(), ...overrides };
  return s;
}

function sourceOf(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

// ==== T1-T3: Prod-Symptom + Gegentests ==============================================

test("T1 Prod-Symptom: veralteter Monatsschluessel (Vormonat) gibt das Kontingent frei (Flag AN)", () => {
  const s = stateWithUsage(TENANT_A, {
    costCents: 779,
    spendMonthKey: "2026-06",
    spendMonthCostCents: 779,
  });
  assert.equal(
    tryReserveOutboundBudget(s, TENANT_A, 60, FLAG_ON, JULY_ISO),
    true,
    "der Vormonats-Schluessel rollt beim Lesen auf 0 - die Reserve passt unter den Cap (heute: false)",
  );
});

test("T2 Gegentest: Schluessel im laufenden Monat haelt das Gate scharf (Flag AN)", () => {
  const s = stateWithUsage(TENANT_A, {
    costCents: 779,
    spendMonthKey: "2026-07",
    spendMonthCostCents: 779,
  });
  assert.equal(tryReserveOutboundBudget(s, TENANT_A, 60, FLAG_ON, JULY_ISO), false);
});

test("T3 Gegentest: Flag AUS bleibt beim Lebenszeit-Zaehler (Bestandsverhalten)", () => {
  const s = stateWithUsage(TENANT_A, {
    costCents: 779,
    spendMonthKey: "2026-06",
    spendMonthCostCents: 779,
  });
  assert.equal(tryReserveOutboundBudget(s, TENANT_A, 60, FLAG_OFF, JULY_ISO), false);
});

// ==== T4: Folgemonat ================================================================

test("T4 Folgemonat: gateUsageCents startet bei 0, usageFor(...).costCents behaelt die Lebenszeitsumme", () => {
  const s = makeDefaultState();
  addVoiceUsageCostCents(s, TENANT_A, 200, JULY_ISO);
  assert.equal(gateUsageCents(s, TENANT_A, FLAG_ON, AUGUST_ISO), 0, "neuer Monat -> Gate liest 0");
  assert.equal(usageFor(s, TENANT_A).costCents, 200, "Lebenszeit-Zaehler bleibt unangetastet");
});

// ==== T5: beide Achsen schalten gemeinsam ===========================================

test("T5 beide Achsen gemeinsam: alle vier Praedikate kippen zusammen zwischen Flag AUS und AN", () => {
  const s = stateWithUsage(TENANT_A, {
    costCents: 900, // Lebenszeit UEBER dem Cap (800)
    spendMonthKey: "2026-07",
    spendMonthCostCents: 100, // laufender Monat UNTER dem Cap
  });
  const RESERVE = 5;
  assert.notEqual(
    budgetExceeded(s, TENANT_A, FLAG_OFF, JULY_ISO),
    budgetExceeded(s, TENANT_A, FLAG_ON, JULY_ISO),
    "budgetExceeded muss zwischen den Flag-Zustaenden kippen",
  );
  assert.notEqual(
    reserveExceedsBudget(s, TENANT_A, RESERVE, FLAG_OFF, JULY_ISO),
    reserveExceedsBudget(s, TENANT_A, RESERVE, FLAG_ON, JULY_ISO),
    "reserveExceedsBudget muss zwischen den Flag-Zustaenden kippen",
  );
  assert.notEqual(
    globalBudgetExceeded(s, FLAG_OFF, JULY_ISO),
    globalBudgetExceeded(s, FLAG_ON, JULY_ISO),
    "globalBudgetExceeded muss zwischen den Flag-Zustaenden kippen",
  );
  assert.notEqual(
    globalReserveExceedsBudget(s, RESERVE, FLAG_OFF, JULY_ISO),
    globalReserveExceedsBudget(s, RESERVE, FLAG_ON, JULY_ISO),
    "globalReserveExceedsBudget muss zwischen den Flag-Zustaenden kippen",
  );
});

// ==== T6-T8: D7-Riegel darf bei Flag AN die Sicherung nie schrumpfen ================

test("T6 D7-Reichweite Tenant: vergifteter Lebenszeit-Zaehler sperrt trotz gesunder Monatszahl (Flag AN)", () => {
  const s = stateWithUsage(TENANT_A, {
    costCents: NaN,
    spendMonthKey: "2026-07",
    spendMonthCostCents: 100, // ohne den Quercheck waere das Gate hier faelschlich offen
  });
  assert.equal(budgetExceeded(s, TENANT_A, FLAG_ON, JULY_ISO), true);
});

test("T7 D7-Reichweite Plattform: vergiftete Lebenszeit-Summe sperrt trotz gesunder Monatssumme (Flag AN)", () => {
  const s = stateWithUsage(TENANT_A, {
    costCents: NaN,
    spendMonthKey: "2026-07",
    spendMonthCostCents: 100,
  });
  assert.equal(globalBudgetExceeded(s, FLAG_ON, JULY_ISO), true);
});

test("T8 D7 auf der Monats-Achse: vergiftete Monatszahl sperrt statt fail-open (Flag AN)", () => {
  const s = stateWithUsage(TENANT_A, {
    costCents: 100, // gesund
    spendMonthKey: "2026-07",
    spendMonthCostCents: NaN,
  });
  assert.equal(
    budgetExceeded(s, TENANT_A, FLAG_ON, JULY_ISO),
    true,
    "NaN >= cap ist false - ohne den D7-Riegel waere das Gate hier blind",
  );
});

// ==== T9: Achsen-Zuordnung ===========================================================

test("T9 Achsen-Zuordnung: Tenant-Praedikate lesen gateUsageCents, Plattform-Praedikate gatePlatformUsageCents", () => {
  const s = makeDefaultState();
  // Lebenszeit- und Monatszahl bewusst GEGENLAEUFIG (nicht nur eine Achse hoch, die andere
  // niedrig): so kann ein Regress, der die Aufloesung durch den rohen Lebenszeit-Zaehler
  // ersetzt, sich NICHT hinter einer zufaellig identischen Summe verstecken.
  s.usage[TENANT_A] = { ...emptyUsage(), costCents: 900, spendMonthKey: "2026-07", spendMonthCostCents: 0 };
  s.usage[TENANT_B] = { ...emptyUsage(), costCents: 0, spendMonthKey: "2026-07", spendMonthCostCents: 900 };
  assert.equal(
    budgetExceeded(s, TENANT_A, FLAG_ON, JULY_ISO),
    false,
    "Tenant A ist im laufenden Monat bei 0 - nur die Lebenszeit-Zahl (900) waere ueber dem Cap",
  );
  assert.equal(
    globalBudgetExceeded(s, FLAG_ON, JULY_ISO),
    true,
    "die Plattform-Monatssumme (A 0 + B 900) liegt ueber dem Cap, obwohl Tenant A selbst frei ist",
  );
});

// ==== T10-T11: genau EINE Aufloesung je Praedikat, genau ZWEI Lesestellen im Modul ===

// Zaehlt Lesezugriffe auf cfg.budgetMonthEnabled ueber einen zaehlenden Getter (kein
// Modul-Mocking noetig: ESM-Namespaces sind nicht patchbar).
function countingCfg(flagValue) {
  const reads = { count: 0 };
  const cfg = {
    ...PRICES,
    get budgetMonthEnabled() {
      reads.count++;
      return flagValue;
    },
  };
  return { cfg, reads };
}

test("T10 Instrumentierung: jedes Praedikat loest GENAU EINE Aufloesung aus (beide Flag-Zustaende)", () => {
  const s = stateWithUsage(TENANT_A, {
    costCents: 100,
    spendMonthKey: "2026-07",
    spendMonthCostCents: 100,
  });
  for (const flagValue of [false, true]) {
    const budgetExceededRead = countingCfg(flagValue);
    budgetExceeded(s, TENANT_A, budgetExceededRead.cfg, JULY_ISO);
    assert.equal(budgetExceededRead.reads.count, 1, `budgetExceeded, flag=${flagValue}`);

    const reserveExceedsBudgetRead = countingCfg(flagValue);
    reserveExceedsBudget(s, TENANT_A, 5, reserveExceedsBudgetRead.cfg, JULY_ISO);
    assert.equal(reserveExceedsBudgetRead.reads.count, 1, `reserveExceedsBudget, flag=${flagValue}`);

    const globalBudgetExceededRead = countingCfg(flagValue);
    globalBudgetExceeded(s, globalBudgetExceededRead.cfg, JULY_ISO);
    assert.equal(globalBudgetExceededRead.reads.count, 1, `globalBudgetExceeded, flag=${flagValue}`);

    const globalReserveExceedsBudgetRead = countingCfg(flagValue);
    globalReserveExceedsBudget(s, 5, globalReserveExceedsBudgetRead.cfg, JULY_ISO);
    assert.equal(globalReserveExceedsBudgetRead.reads.count, 1, `globalReserveExceedsBudget, flag=${flagValue}`);

    // tryReserveOutboundBudget ruft reserveExceedsBudget UND globalReserveExceedsBudget -
    // also GENAU EINE Aufloesung je Achse, keine dritte.
    const tryReserveRead = countingCfg(flagValue);
    tryReserveOutboundBudget(s, TENANT_A, 5, tryReserveRead.cfg, JULY_ISO);
    assert.equal(tryReserveRead.reads.count, 2, `tryReserveOutboundBudget, flag=${flagValue}`);
  }
});

test("T11 Zaehler-Fundament: 'budgetMonthEnabled' kommt in state-ops.js GENAU ZWEIMAL vor", () => {
  const source = sourceOf("../src/store/state-ops.js");
  const matches = source.match(/budgetMonthEnabled/g) || [];
  assert.equal(
    matches.length,
    2,
    "genau zwei Lesestellen - je eine pro Aufloesungsfunktion (gateUsageCents/gatePlatformUsageCents); " +
      "eine dritte Fundstelle waere eine dritte, unkontrollierte Flag-Auswertung",
  );
});

// ==== T12-T13: Quelltext-Invarianten der vier Praedikate + der Reserve-Funktion =====

// Extrahiert den Funktionsrumpf zwischen der Signatur und der ERSTEN Top-Level-
// schliessenden Klammer (eigene Zeile) - Muster test/platform-spend-warning.test.js T15.
// Alle hier gepruefte Funktionen sind flach (keine verschachtelten Bloecke mit eigener
// schliessender Zeile), das genuegt.
function functionBody(source, name) {
  const start = new RegExp(`export function ${name}\\([^)]*\\) \\{`).exec(source);
  assert.ok(start, `Funktion ${name} nicht in state-ops.js gefunden`);
  const bodyStart = start.index + start[0].length;
  const bodyEnd = source.indexOf("\n}", bodyStart);
  assert.ok(bodyEnd > bodyStart, `Rumpfende von ${name} nicht gefunden`);
  return source.slice(bodyStart, bodyEnd);
}

test("T12 Quelltext: die vier Gate-Praedikate lesen 'costCents' nie direkt (die Aufloesung ist Pflicht)", () => {
  const source = sourceOf("../src/store/state-ops.js");
  for (const name of [
    "budgetExceeded",
    "reserveExceedsBudget",
    "globalBudgetExceeded",
    "globalReserveExceedsBudget",
  ]) {
    const body = functionBody(source, name);
    assert.ok(
      !body.includes("costCents"),
      `${name} darf 'costCents' nicht direkt lesen - das waere ein Umgehen der Aufloesungsfunktion`,
    );
  }
});

test("T13 TOCTOU: tryReserveOutboundBudget bleibt rein synchron (kein await/async im Rumpf)", () => {
  const source = sourceOf("../src/store/state-ops.js");
  const body = functionBody(source, "tryReserveOutboundBudget");
  assert.ok(!/\bawait\b/.test(body), "kein await zwischen Check und Increment");
  assert.ok(!/\basync\b/.test(body), "die Funktion bleibt nicht-async");
});

// ==== T14-T16: Config-Oberflaeche + Doku-Parity =====================================

test("T14 Config-Oberflaeche: config.billing.budgetMonthEnabled ist ueber den echten guardedConfig-Proxy lesbar", () => {
  assert.doesNotThrow(() => config.billing.budgetMonthEnabled);
  assert.equal(typeof config.billing.budgetMonthEnabled, "boolean");
});

test("T15 Code-Default: BUDGET_MONTH_ENABLED faellt env-unabhaengig auf false zurueck", () => {
  const source = sourceOf("../src/config.js");
  assert.match(
    source,
    /boolEnv\("BUDGET_MONTH_ENABLED",\s*process\.env\.BUDGET_MONTH_ENABLED,\s*\{\s*fallback:\s*false,?\s*\}\)/,
    "Default-Pin gegen den Code, NICHT gegen die ambiente Env (Lehre test-base-env-drift)",
  );
});

test("T16 Doku-Parity: .env.example und render.yaml dokumentieren BUDGET_MONTH_ENABLED=false", () => {
  const envExample = sourceOf("../.env.example");
  assert.match(envExample, /^BUDGET_MONTH_ENABLED=false$/m, "BUDGET_MONTH_ENABLED fehlt in .env.example");

  const renderYaml = sourceOf("../render.yaml");
  assert.match(
    renderYaml,
    /key:\s*BUDGET_MONTH_ENABLED\s*\n\s*value:\s*"false"/,
    "BUDGET_MONTH_ENABLED fehlt in render.yaml",
  );
});

// ==== T17: P6-Fruehwarnung bleibt auf derselben Achse wie das Gate =================

test("T17 P6-Kohaerenz: die Fruehwarnung misst dieselbe Achse wie das Gate (kein Dauer-Fehlalarm nach dem Flip)", () => {
  const cfg = { ...FLAG_ON, platformSpendWarnPercent: 50 }; // Schwelle = 800 * 50 = 40000 (skaliert)
  const s = stateWithUsage(TENANT_A, {
    costCents: 900, // Lebenszeit WEIT ueber der Schwelle
    spendMonthKey: "2026-07",
    spendMonthCostCents: 100, // laufender Monat UNTER der Schwelle
  });
  assert.equal(
    claimPlatformSpendWarning(s, cfg, JULY_ISO),
    null,
    "misst die Warnung die Lebenszeit-Achse statt der Gate-Achse, waere das nach dem Flip ein Dauer-Fehlalarm",
  );
});
