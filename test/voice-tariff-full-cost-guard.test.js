// LCT P4b (Vollkosten-Boot-Guard): sichert die spaetere Owner-Tarifsenkung ab. Muster
// test/cost-truing-booking-guard.test.js.
//   (Wahrheitstabelle) Unit: voiceTariffFloorFindings (src/boot-guard.js) - reine
//       Entscheidung. Seit KV2-10 feuert sie auf belowFloor ALLEIN (deckungs-
//       unabhaengig, Kriterium (c)); bis KV2-9 war es die Konjunktion aus zwei Schwellen.
//   (p)/(q)/(r) Boot-Beweis: Spawn-Tests, Seed-Bauer outboundCallsSeed (G5: geteilt mit
//       cost-truing-booking-guard.test.js, definiert in test/helpers.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceTariffFloorFindings, VOICE_TARIFF_FLOOR_FINDING } from "../src/boot-guard.js";
import { startServer, seedState, outboundCallsSeed } from "./helpers.js";

// ---- Unit: voiceTariffFloorFindings (Konjunktions-Wahrheitstabelle) ----

test("U1: belowFloor && thinCoverage (6<10, 20<80) -> genau ein Befund, fatal:false, BELOW_FULL_COST", () => {
  const findings = voiceTariffFloorFindings({
    domesticTariffCents: 6,
    fullCostFloorCents: 10,
    coveragePercent: 20,
    minCoveragePercent: 80,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, false);
  assert.equal(findings[0].code, VOICE_TARIFF_FLOOR_FINDING.BELOW_FULL_COST);
});

test("U2 (KV2-10): nur belowFloor (6<10, Deckung 90 >= 80) -> GENAU EIN Befund (Deckung schweigt den Boden nicht mehr)", () => {
  const findings = voiceTariffFloorFindings({
    domesticTariffCents: 6,
    fullCostFloorCents: 10,
    coveragePercent: 90,
    minCoveragePercent: 80,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, false);
  assert.equal(findings[0].code, VOICE_TARIFF_FLOOR_FINDING.BELOW_FULL_COST);
  assert.match(findings[0].message, /Abgleich-Deckung 90%/);
  assert.match(findings[0].message, /COST_TRUING_MIN_COVERAGE_PERCENT=80%/);
  assert.match(findings[0].message, /kein\s+Ausloeser mehr/);
});

test("U3: nur thinCoverage (20>=10, 20<80) -> []", () => {
  const findings = voiceTariffFloorFindings({
    domesticTariffCents: 20,
    fullCostFloorCents: 10,
    coveragePercent: 20,
    minCoveragePercent: 80,
  });
  assert.deepEqual(findings, []);
});

test("U4: keins (20>=10, 90>=80) -> []", () => {
  const findings = voiceTariffFloorFindings({
    domesticTariffCents: 20,
    fullCostFloorCents: 10,
    coveragePercent: 90,
    minCoveragePercent: 80,
  });
  assert.deepEqual(findings, []);
});

test("U5: Gleichstand Tarif==Schwelle (10<10 false) -> [] (strikt <, Gleichstand ist gedeckt)", () => {
  const findings = voiceTariffFloorFindings({
    domesticTariffCents: 10,
    fullCostFloorCents: 10,
    coveragePercent: 20,
    minCoveragePercent: 80,
  });
  assert.deepEqual(findings, []);
});

test("U6 (KV2-10): Gleichstand Coverage==Schwelle bei belowFloor (6<10, 80==80) -> GENAU EIN Befund", () => {
  const findings = voiceTariffFloorFindings({
    domesticTariffCents: 6,
    fullCostFloorCents: 10,
    coveragePercent: 80,
    minCoveragePercent: 80,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, VOICE_TARIFF_FLOOR_FINDING.BELOW_FULL_COST);
});

// ---- Boot-Beweis ----
// Seed-Bauer outboundCallsSeed (G5): geteilt mit cost-truing-booking-guard.test.js, in
// test/helpers.js. 10 Calls, davon `proven` bewiesen, IDs mit Praefix call_q_.

test("(p) Tarif 6 < Schwelle 10, Deckung 20% < 80% -> genau EINE WARN-Zeile mit beiden Zahlen, /healthz 200, kein exit", async () => {
  const srv = await startServer({
    env: { VOICE_TARIFF_DOMESTIC_CENTS: "6", VOICE_TARIFF_FULL_COST_FLOOR_CENTS: "10" },
    seed: outboundCallsSeed(10, 2, "call_q_"),
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    const warn = srv.stdout.match(/Vollkostenschwelle VOICE_TARIFF_FULL_COST_FLOOR_CENTS=10/g);
    assert.equal(warn ? warn.length : 0, 1, `erwartet genau eine WARN-Zeile, Output:\n${srv.stdout}`);
    assert.match(srv.stdout, /VOICE_TARIFF_DOMESTIC_CENTS=6/);
    assert.match(srv.stdout, /Abgleich-Deckung 20%/);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
  } finally {
    await srv.stop();
  }
});

test("(q1) KV2-10: Tarif 6 < Schwelle 10, Deckung 90% >= 80% -> GENAU EINE WARN (Deckung schweigt den Boden nicht mehr laenger)", async () => {
  const srv = await startServer({
    env: { VOICE_TARIFF_DOMESTIC_CENTS: "6", VOICE_TARIFF_FULL_COST_FLOOR_CENTS: "10" },
    seed: outboundCallsSeed(10, 9, "call_q_"),
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    const warn = srv.stdout.match(/Vollkostenschwelle VOICE_TARIFF_FULL_COST_FLOOR_CENTS=10/g);
    assert.equal(warn ? warn.length : 0, 1, `erwartet genau eine WARN-Zeile, Output:\n${srv.stdout}`);
    assert.match(srv.stdout, /VOICE_TARIFF_DOMESTIC_CENTS=6/);
    assert.match(srv.stdout, /Abgleich-Deckung 90%/);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
  } finally {
    await srv.stop();
  }
});

test("(q2) Tarif 20 >= Schwelle 10, Deckung 20% < 80% -> keine Meldung (Guard feuert nur in der Konjunktion)", async () => {
  const srv = await startServer({
    env: { VOICE_TARIFF_DOMESTIC_CENTS: "20", VOICE_TARIFF_FULL_COST_FLOOR_CENTS: "10" },
    seed: outboundCallsSeed(10, 2, "call_q_"),
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /Vollkostenschwelle/);
  } finally {
    await srv.stop();
  }
});

test("(r) Tarif 6 < Schwelle 10, leerer Spiegel (Nenner 0 -> 0% Deckung) -> eine WARN, kein Freispruch", async () => {
  const srv = await startServer({
    env: { VOICE_TARIFF_DOMESTIC_CENTS: "6", VOICE_TARIFF_FULL_COST_FLOOR_CENTS: "10" },
    seed: seedState({ calls: [] }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.match(srv.stdout, /Abgleich-Deckung 0%/);
  } finally {
    await srv.stop();
  }
});
