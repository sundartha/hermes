// P2/OT-4 AC1-AC3: numerische Env-Parses fail-closed. numEnv() parst UND validiert
// (NaN/Infinity/Bereich -> Fatal statt stillem no-op), configFatalErrors() sammelt
// die Befunde, assertConfig() faellt bei numerischem Fatal. Rein-Unit gegen die
// exportierten Funktionen (kein Spawn). fatalConfigErrors ist Modul-Scope und
// akkumuliert ueber die Tests DIESER Datei -> Assertions sind delta-/some-basiert
// (jede Testdatei laeuft als eigener node:test-Kindprozess, keine Cross-File-Leaks).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config, assertConfig, numEnv, configFatalErrors, eurToCents } from "../src/config.js";
import { makeConfigOverrides, CONFIG_REQUIRED_OK } from "./helpers.js";

// console.error abfangen, ohne den Testlauf zuzumuellen. Liefert die Zeilen.
function captureConsoleError(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return lines;
}

// Pflichtfelder erfuellen, NUR den geprueften Aspekt variieren (Test-Isolation).
const { withConfigOverrides } = makeConfigOverrides(config);

test("T-P2-01: NaN-Budget -> numEnv sammelt Fatal (nennt MAX_BUDGET_EUR)", () => {
  numEnv("MAX_BUDGET_EUR", "acht", { fallback: 8, min: 0, integer: false });
  assert.ok(
    configFatalErrors().some((e) => e.includes("MAX_BUDGET_EUR")),
    "configFatalErrors muss MAX_BUDGET_EUR nennen",
  );
});

test("T-P2-02: gueltiges Budget -> kein neuer Fatal, korrekter Float-Wert", () => {
  const before = configFatalErrors().length;
  const v = numEnv("MAX_BUDGET_EUR", "12.5", { fallback: 8, min: 0, integer: false });
  assert.equal(v, 12.5);
  assert.equal(configFatalErrors().length, before, "valider Wert darf keinen Fatal erzeugen");
});

test("S1-COV-1: eurToCents rundet die JS-Float-Falle korrekt (0.29 EUR -> exakt 29 Cent, nicht 28)", () => {
  // 0.29 * 100 === 28.999999999999996 in JS-Float-Arithmetik (node -e verifiziert).
  // Ohne Math.round wuerde maxBudgetCents lautlos knapp UNTER dem konfigurierten
  // MAX_BUDGET_EUR-Cap landen. Alle bisherigen Testwerte (1, 8, 12.5) sind exakt
  // darstellbar und haetten diesen Bug NICHT sichtbar gemacht.
  assert.equal(eurToCents(0.29), 29);
  // Grenzfall 0 (Not-Aus-Wert wie bei MAX_CALLS_PER_HOUR) bleibt exakt 0.
  assert.equal(eurToCents(0), 0);
});

test("T-P2-03: negativer Gate-Wert -> Fatal (nennt Minimum); '0' bleibt gueltiger Not-Aus", () => {
  const beforeNeg = configFatalErrors().length;
  numEnv("MAX_CALLS_PER_HOUR", "-1", { fallback: 6, min: 0 });
  const added = configFatalErrors().slice(beforeNeg);
  assert.ok(
    added.some((e) => e.includes("MAX_CALLS_PER_HOUR") && e.includes("Minimum")),
    "negativer Gate-Wert muss als Minimum-Verletzung gemeldet werden",
  );
  const before0 = configFatalErrors().length;
  const v0 = numEnv("MAX_CALLS_PER_HOUR", "0", { fallback: 6, min: 0 });
  assert.equal(v0, 0);
  assert.equal(configFatalErrors().length, before0, "0 ist gueltiger Not-Aus, kein Fatal");
});

test("T-P2-04: maxCallDurationS NaN -> Fatal (kein stilles 300); Clamp-Pfad bleibt", () => {
  const before = configFatalErrors().length;
  numEnv("MAX_CALL_DURATION_S", "lang", { fallback: 180, min: 1, max: 300 });
  assert.ok(
    configFatalErrors()
      .slice(before)
      .some((e) => e.includes("MAX_CALL_DURATION_S")),
    "NaN-Max-Dauer muss Fatal sein (frueheres Math.min(NaN,300)-Loch geschlossen)",
  );
  // Clamp bleibt Bestandsverhalten: > max -> max, KEIN Fatal.
  const beforeClamp = configFatalErrors().length;
  const clamped = numEnv("MAX_CALL_DURATION_S", "600", { fallback: 180, min: 1, max: 300 });
  assert.equal(clamped, 300, "Wert ueber Obergrenze wird auf max geklemmt");
  assert.equal(configFatalErrors().length, beforeClamp, "Clamp ist kein Fatal");
});

test("T-P2-05: assertConfig faellt bei numerischem Fatal und nennt die Var", () => {
  withConfigOverrides(CONFIG_REQUIRED_OK, () => {
    numEnv("RATE_LIMIT_PER_MIN", "kaputt", { fallback: 120, min: 0 }); // erzeugt Fatal
    const lines = captureConsoleError(() => {
      assert.equal(assertConfig(), false, "numerischer Fatal -> assertConfig false");
    });
    assert.ok(
      lines.join("\n").includes("RATE_LIMIT_PER_MIN"),
      "Diagnose muss die verletzte Var nennen",
    );
  });
});

// P9-CFG1 (Review-Blocker): TELNYX_LOOP_GUARD_MAX_EMPTY_TURNS bekam urspruenglich nur
// {fallback, min}, KEIN max - ein absurd hoher Hosting-Wert (z.B. 999999) haette den
// Kosten-Notaus lautlos inert geschaltet. Symmetrisch zu T-P2-04 (MAX_CALL_DURATION_S):
// max ist ein bewusster Clamp, KEIN Fatal.
test("T-P2-06: TELNYX_LOOP_GUARD_MAX_EMPTY_TURNS absurd hoch -> auf max 50 geklemmt (kein Fatal)", () => {
  const before = configFatalErrors().length;
  const clamped = numEnv("TELNYX_LOOP_GUARD_MAX_EMPTY_TURNS", "999999", {
    fallback: 8,
    min: 3,
    max: 50,
  });
  assert.equal(
    clamped,
    50,
    "Wert ueber der Obergrenze wird geklemmt statt den Loop-Guard stillzulegen",
  );
  assert.equal(configFatalErrors().length, before, "Clamp ist kein Fatal");
});

// S1-3: PROVISIONING_REDRIVE_MAX_AGE_MS muss strikt < 24h bleiben (kleinstes Anbieter-
// Idempotenzfenster/Stripe-Hold), sonst oeffnet ein zu grosser Hosting-Wert den Doppelkauf-Pfad.
// Frischer config-Import pro Env-Wert (Query-String = eigener Modul-Cache-Key): config wird EINMAL
// beim Import aus process.env gebaut. Unter NODE_ENV=test (npm test) ist dotenv aus -> keine
// .env-Interferenz. KEIN Spawn (in-process fresh import).
test("S1-3: config klemmt PROVISIONING_REDRIVE_MAX_AGE_MS strikt unter das 24h-Doppelkauf-Fenster", async () => {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const saved = process.env.PROVISIONING_REDRIVE_MAX_AGE_MS;
  const freshConfig = async (raw, tag) => {
    process.env.PROVISIONING_REDRIVE_MAX_AGE_MS = raw;
    return import(`../src/config.js?s1-3-${tag}`);
  };
  try {
    const atDay = await freshConfig(String(MS_PER_DAY), "day"); // exakt 24h
    assert.equal(atDay.config.provisioningRedriveMaxAgeMs, MS_PER_DAY - 1, "24h -> auf 24h-1ms geklemmt");
    assert.ok(
      !atDay.configFatalErrors().some((e) => e.includes("PROVISIONING_REDRIVE_MAX_AGE_MS")),
      "Clamp ist KEIN Fatal",
    );
    const atEdge = await freshConfig(String(MS_PER_DAY - 1), "edge");
    assert.equal(atEdge.config.provisioningRedriveMaxAgeMs, MS_PER_DAY - 1, "24h-1ms bleibt unveraendert");
    const atZero = await freshConfig("0", "zero");
    assert.equal(atZero.config.provisioningRedriveMaxAgeMs, 0, "0 (Observe-Only) bleibt 0");
  } finally {
    if (saved === undefined) delete process.env.PROVISIONING_REDRIVE_MAX_AGE_MS;
    else process.env.PROVISIONING_REDRIVE_MAX_AGE_MS = saved;
  }
});
