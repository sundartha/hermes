// P2/OT-4 AC1-AC3: numerische Env-Parses fail-closed. numEnv() parst UND validiert
// (NaN/Infinity/Bereich -> Fatal statt stillem no-op), configFatalErrors() sammelt
// die Befunde, assertConfig() faellt bei numerischem Fatal. Rein-Unit gegen die
// exportierten Funktionen (kein Spawn). fatalConfigErrors ist Modul-Scope und
// akkumuliert ueber die Tests DIESER Datei -> Assertions sind delta-/some-basiert
// (jede Testdatei laeuft als eigener node:test-Kindprozess, keine Cross-File-Leaks).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config, assertConfig, numEnv, configFatalErrors } from "../src/config.js";

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
function withConfig(overrides, fn) {
  const saved = {};
  for (const k of Object.keys(overrides)) saved[k] = config[k];
  Object.assign(config, overrides);
  try {
    return fn();
  } finally {
    Object.assign(config, saved);
  }
}
const REQUIRED_OK = {
  anthropicApiKey: "x",
  twilioSid: "x",
  twilioToken: "x",
  twilioNumber: "+49123",
  ownerFirstName: "Max",
  ownerLastName: "Mustermann", // G1: Boot-Pflicht
  publicUrl: "https://example.test",
  mcpAuth: "",
  storeBackend: "json",
  paymentEnabled: false,
};

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
  withConfig(REQUIRED_OK, () => {
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
