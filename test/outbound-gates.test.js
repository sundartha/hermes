// P1 (S1-6): Unit-Test fuer resolveMaxDurationS (src/telephony/outbound-gates.js).
// Reine Funktion (raw, cfg) -> Sekunden, kein Netz/Store/Server (F.I.R.S.T.). Beweist
// den Positivitaets-/Endlichkeits-Guard: negative/0/NaN/leere Body-Werte fallen NIE
// bis zu einer negativen Reserve durch (vorheriger `x || DEFAULT`-Trap liess negative
// Zahlen als "truthy" passieren), und der Cap greift auch bei einem riesigen Body-Wert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMaxDurationS } from "../src/telephony/outbound-gates.js";

const CFG = { maxCallDurationS: 180 };
const DEFAULT_S = 180; // == CFG.maxCallDurationS in diesem Setup (kein config-Fallback-Fall)
const CAP_S = 300;

test("resolveMaxDurationS: negativer/0/NaN/leerer/fehlender Body-Wert faellt auf den config-Default", () => {
  assert.equal(resolveMaxDurationS(-300, CFG), DEFAULT_S, "negativ -> nie truthy-durchgereicht");
  assert.equal(resolveMaxDurationS(0, CFG), DEFAULT_S, "0 -> Default");
  assert.equal(resolveMaxDurationS(NaN, CFG), DEFAULT_S, "NaN -> Default");
  assert.equal(resolveMaxDurationS(undefined, CFG), DEFAULT_S, "undefined -> Default");
  assert.equal(resolveMaxDurationS("", CFG), DEFAULT_S, "leerer String -> Default");
});

test("resolveMaxDurationS: gueltiger Body-Wert (String oder Zahl) gewinnt", () => {
  assert.equal(resolveMaxDurationS("250", CFG), 250, "numerischer String wird geparst");
  assert.equal(resolveMaxDurationS(250, CFG), 250, "Zahl direkt");
  assert.equal(resolveMaxDurationS(1, CFG), 1, "kleinster gueltiger Wert bleibt 1");
});

test("resolveMaxDurationS: MAX_CALL_DURATION_CAP_S deckelt jeden ueberlangen Wert", () => {
  assert.equal(resolveMaxDurationS(99999, CFG), CAP_S, "riesiger Body-Wert wird gekappt");
  assert.equal(resolveMaxDurationS(301, CFG), CAP_S, "ein Tick ueber dem Cap wird gekappt");
});

test("resolveMaxDurationS: ungueltiger Body UND ungueltiger config-Default -> DEFAULT_CALL_DURATION_S, nie NaN", () => {
  const result = resolveMaxDurationS(undefined, { maxCallDurationS: undefined });
  assert.equal(result, DEFAULT_S, "harter Hard-Default greift, wenn beide Kandidaten ungueltig sind");
  assert.ok(Number.isFinite(result), "niemals NaN");
});
