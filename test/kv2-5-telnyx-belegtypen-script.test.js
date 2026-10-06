import { test } from "node:test";
import assert from "node:assert/strict";
import { RECORD_TYPES_TO_PROBE, baueErgebnis } from "../scripts/kv2-5-telnyx-belegtypen.mjs";

test("KV2-5: RECORD_TYPES_TO_PROBE fuehrt inference", () => {
  assert.ok(RECORD_TYPES_TO_PROBE.includes("inference"));
});

test("KV2-5: baueErgebnis liest inference-Records, statt sie stets mit 0 vorzutaeuschen", () => {
  const ERWARTETE_ANZAHL = 2;
  const ERWARTETE_SUMME_USD = 0.2;
  const recordsByType = new Map([
    ["sip-trunking", []],
    ["inference", [{ cost: "0.12" }, { cost: "0.08" }]],
  ]);
  const ergebnis = baueErgebnis({ recordsByType, knownSipCallIds: [] });
  assert.equal(ergebnis.inference_anzahl, ERWARTETE_ANZAHL);
  assert.equal(ergebnis.inference_summe_usd, ERWARTETE_SUMME_USD);
});

test("KV2-5: baueErgebnis meldet ehrlich 0, wenn wirklich keine inference-Records vorliegen", () => {
  const recordsByType = new Map([
    ["sip-trunking", []],
    ["inference", []],
  ]);
  const ergebnis = baueErgebnis({ recordsByType, knownSipCallIds: [] });
  assert.equal(ergebnis.inference_anzahl, 0);
  assert.equal(ergebnis.inference_summe_usd, 0);
});
