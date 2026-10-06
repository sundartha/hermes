import { test } from "node:test";
import assert from "node:assert/strict";
import { config, assertConfig, numEnv, configFatalErrors, eurToCents } from "../src/config.js";
import { makeConfigOverrides, CONFIG_REQUIRED_OK } from "./helpers.js";

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
  assert.equal(eurToCents(0.29), 29);
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

test("T-P2-04: deadAirTimeoutS NaN -> Fatal (kein stilles max); Clamp-Pfad bleibt", () => {
  const before = configFatalErrors().length;
  numEnv("TELNYX_DEAD_AIR_TIMEOUT_S", "lang", { fallback: 45, min: 5, max: 300 });
  assert.ok(
    configFatalErrors()
      .slice(before)
      .some((e) => e.includes("TELNYX_DEAD_AIR_TIMEOUT_S")),
    "ein NaN-Wert muss Fatal sein (frueheres Math.min(NaN,max)-Loch geschlossen)",
  );
  const beforeClamp = configFatalErrors().length;
  const clamped = numEnv("TELNYX_DEAD_AIR_TIMEOUT_S", "600", { fallback: 45, min: 5, max: 300 });
  assert.equal(clamped, 300, "Wert ueber Obergrenze wird auf max geklemmt");
  assert.equal(configFatalErrors().length, beforeClamp, "Clamp ist kein Fatal");
});

test("T-P2-05: assertConfig faellt bei numerischem Fatal und nennt die Var", () => {
  withConfigOverrides(CONFIG_REQUIRED_OK, () => {
    numEnv("RATE_LIMIT_PER_MIN", "kaputt", { fallback: 120, min: 0 });
    const lines = captureConsoleError(() => {
      assert.equal(assertConfig(), false, "numerischer Fatal -> assertConfig false");
    });
    assert.ok(
      lines.join("\n").includes("RATE_LIMIT_PER_MIN"),
      "Diagnose muss die verletzte Var nennen",
    );
  });
});

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

test("S1-3: config klemmt PROVISIONING_REDRIVE_MAX_AGE_MS strikt unter das 24h-Doppelkauf-Fenster", async () => {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const saved = process.env.PROVISIONING_REDRIVE_MAX_AGE_MS;
  const freshConfig = async (raw, tag) => {
    process.env.PROVISIONING_REDRIVE_MAX_AGE_MS = raw;
    return import(`../src/config.js?s1-3-${tag}`);
  };
  try {
    const atDay = await freshConfig(String(MS_PER_DAY), "day");
    assert.equal(atDay.config.provisioning.provisioningRedriveMaxAgeMs, MS_PER_DAY - 1, "24h -> auf 24h-1ms geklemmt");
    assert.ok(
      !atDay.configFatalErrors().some((e) => e.includes("PROVISIONING_REDRIVE_MAX_AGE_MS")),
      "Clamp ist KEIN Fatal",
    );
    const atEdge = await freshConfig(String(MS_PER_DAY - 1), "edge");
    assert.equal(atEdge.config.provisioning.provisioningRedriveMaxAgeMs, MS_PER_DAY - 1, "24h-1ms bleibt unveraendert");
    const atZero = await freshConfig("0", "zero");
    assert.equal(atZero.config.provisioning.provisioningRedriveMaxAgeMs, 0, "0 (Observe-Only) bleibt 0");
  } finally {
    if (saved === undefined) delete process.env.PROVISIONING_REDRIVE_MAX_AGE_MS;
    else process.env.PROVISIONING_REDRIVE_MAX_AGE_MS = saved;
  }
});

test("T-P2-07: Int-Trailing-Muell '120abc' -> Fatal + Fallback (kein stiller Teilwert 120)", () => {
  const before = configFatalErrors().length;
  const v = numEnv("MAX_CALLS_PER_HOUR", "120abc", { fallback: 6, min: 0 });
  assert.equal(v, 6, "teil-numerischer Muell darf NICHT still auf 120 kippen, sondern Fallback");
  assert.ok(
    configFatalErrors()
      .slice(before)
      .some((e) => e.includes("MAX_CALLS_PER_HOUR")),
    "'120abc' muss einen Fatal erzeugen, der die Var nennt",
  );
});

test("T-P2-08: Float-Trailing-Muell '8.5abc' -> Fatal + Fallback (kein stiller Teilwert 8.5)", () => {
  const before = configFatalErrors().length;
  const v = numEnv("MAX_BUDGET_EUR", "8.5abc", { fallback: 8, min: 0, integer: false });
  assert.equal(v, 8, "teil-numerischer Float-Muell darf NICHT still auf 8.5 kippen, sondern Fallback");
  assert.ok(
    configFatalErrors()
      .slice(before)
      .some((e) => e.includes("MAX_BUDGET_EUR")),
    "'8.5abc' muss einen Fatal erzeugen, der die Var nennt",
  );
});

test("T-P2-09: Rand-Whitespace bleibt gueltig (Int '  6  ' und Float '  8.5  ' - kein neuer Fatal)", () => {
  const beforeInt = configFatalErrors().length;
  const vi = numEnv("MAX_CALLS_PER_HOUR", "  6  ", { fallback: 6, min: 0 });
  assert.equal(vi, 6, "Rand-Whitespace um eine Ganzzahl bleibt gueltig");
  assert.equal(configFatalErrors().length, beforeInt, "getrimmte gueltige Ganzzahl erzeugt keinen Fatal");
  const beforeFloat = configFatalErrors().length;
  const vf = numEnv("MAX_BUDGET_EUR", "  8.5  ", { fallback: 8, min: 0, integer: false });
  assert.equal(vf, 8.5, "Rand-Whitespace um eine Dezimalzahl bleibt gueltig");
  assert.equal(configFatalErrors().length, beforeFloat, "getrimmte gueltige Dezimalzahl erzeugt keinen Fatal");
});

test("T-P2-10: Trailing-Muell an einem Gate -> assertConfig verweigert Boot (nennt die Var)", () => {
  withConfigOverrides(CONFIG_REQUIRED_OK, () => {
    numEnv("RATE_LIMIT_PER_MIN", "120abc", { fallback: 120, min: 0 });
    const lines = captureConsoleError(() => {
      assert.equal(assertConfig(), false, "teil-numerischer Fatal -> assertConfig false (Boot-Refusal)");
    });
    assert.ok(
      lines.join("\n").includes("RATE_LIMIT_PER_MIN"),
      "Diagnose muss die verletzte Var nennen",
    );
  });
});
