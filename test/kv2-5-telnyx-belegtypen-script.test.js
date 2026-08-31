// KV2-5 Review-Blocker (Runde 1): scripts/kv2-5-telnyx-belegtypen.mjs versprach im
// Kopfkommentar eine Q3-Messung (traegt record_type=inference ueberhaupt Betraege?),
// holte den Typ aber nie ab (RECORD_TYPES_TO_PROBE fuehrte ihn nicht) - baueErgebnis()
// las damit IMMER die leere Liste und druckte "inference n=0 summe_usd=0" als waere es
// gemessen, ein Falsch-Negativ per Konstruktion. Pinnt: (1) "inference" ist Teil der
// Probe-Liste, (2) baueErgebnis() liest tatsaechlich vorhandene inference-Records statt
// sie mangels Abruf zu uebersehen. Netzfrei (main() laeuft dank istHauptmodul-Wache nicht
// beim Import, kein TELNYX_API_KEY noetig).
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
