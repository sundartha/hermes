// P6/S2-1: boolEnv() faellt fail-closed - eine GESETZTE, aber nicht-exakte Boolean-Env
// ("1"/"yes"/"True") darf NICHT still auf den Fallback kippen. Rein-Unit gegen die
// exportierte Funktion (Muster config-failclosed.test.js) + Kill-Switch-Beweis via
// Fresh-Import (Query-String-Cache-Buster, Muster S1-3 in config-failclosed.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { boolEnv, configFatalErrors, assertConfig, config } from "../src/config.js";
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

test("boolEnv: unset/leer -> fallback ohne Fatal (beide Richtungen)", () => {
  const before = configFatalErrors().length;
  assert.equal(boolEnv("X_A", undefined, { fallback: false }), false);
  assert.equal(boolEnv("X_B", undefined, { fallback: true }), true);
  assert.equal(boolEnv("X_C", "", { fallback: true }), true);
  assert.equal(configFatalErrors().length, before, "abwesend/leer darf keinen Fatal erzeugen");
});

test('boolEnv: "true"/"false" -> Bool ohne Fatal', () => {
  const before = configFatalErrors().length;
  assert.equal(boolEnv("X_T", "true", { fallback: false }), true);
  assert.equal(boolEnv("X_F", "false", { fallback: true }), false);
  assert.equal(configFatalErrors().length, before);
});

test('boolEnv: " True "/"FALSE" werden getrimmt+lowercased (kein Fatal)', () => {
  const before = configFatalErrors().length;
  assert.equal(boolEnv("X_TRIM", " True ", { fallback: false }), true);
  assert.equal(boolEnv("X_CASE", "FALSE", { fallback: true }), false);
  assert.equal(configFatalErrors().length, before);
});

test('boolEnv: "1"/"yes"/"on"/"maybe"/"0"/"no" -> Fatal + fallback', () => {
  for (const bad of ["1", "yes", "on", "maybe", "0", "no"]) {
    const before = configFatalErrors().length;
    assert.equal(boolEnv("X_BAD", bad, { fallback: false }), false, `${bad} -> Fallback`);
    assert.ok(
      configFatalErrors()
        .slice(before)
        .some((e) => e.includes("X_BAD")),
      `${bad} muss Fatal (X_BAD) erzeugen`,
    );
  }
});

test("boolEnv: Fatal -> assertConfig() === false und nennt die Var", () => {
  withConfigOverrides(CONFIG_REQUIRED_OK, () => {
    boolEnv("SOME_SWITCH", "kaputt", { fallback: false });
    const lines = captureConsoleError(() => assert.equal(assertConfig(), false));
    assert.ok(lines.join("\n").includes("SOME_SWITCH"));
  });
});

test('Kill-Switch: OUTBOUND_FROZEN="TRUE" -> config.outboundFrozen===true (kein stiller Fail-Open)', async () => {
  const saved = process.env.OUTBOUND_FROZEN;
  try {
    process.env.OUTBOUND_FROZEN = "TRUE";
    const fresh = await import("../src/config.js?boolenv-frozen-true");
    assert.equal(fresh.config.safety.outboundFrozen, true);
    assert.ok(
      !fresh.configFatalErrors().some((e) => e.includes("OUTBOUND_FROZEN")),
      "normalisierbarer Wert ist kein Fatal",
    );
  } finally {
    if (saved === undefined) delete process.env.OUTBOUND_FROZEN;
    else process.env.OUTBOUND_FROZEN = saved;
  }
});

test('Kill-Switch: OUTBOUND_FROZEN="1" -> Fatal + Fallback false (Boot-Refusal statt Fail-Open)', async () => {
  const saved = process.env.OUTBOUND_FROZEN;
  try {
    process.env.OUTBOUND_FROZEN = "1";
    const fresh = await import("../src/config.js?boolenv-frozen-bad");
    assert.equal(fresh.config.safety.outboundFrozen, false);
    assert.ok(fresh.configFatalErrors().some((e) => e.includes("OUTBOUND_FROZEN")));
  } finally {
    if (saved === undefined) delete process.env.OUTBOUND_FROZEN;
    else process.env.OUTBOUND_FROZEN = saved;
  }
});
