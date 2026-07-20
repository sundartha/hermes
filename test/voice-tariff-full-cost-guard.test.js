// LCT P4b (Vollkosten-Boot-Guard): sichert die spaetere Owner-Tarifsenkung ab. Muster
// test/cost-truing-booking-guard.test.js.
//   (Wahrheitstabelle) Unit: voiceTariffFloorFindings (src/boot-guard.js) - reine
//       Entscheidung, Konjunktion aus zwei Schwellen.
//   (p)/(q)/(r) Boot-Beweis: Spawn-Tests, Muster fiveCallsSeed -> tenCallsSeed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceTariffFloorFindings, VOICE_TARIFF_FLOOR_FINDING } from "../src/boot-guard.js";
import { startServer, seedState, seedCall } from "./helpers.js";

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

test("U2: nur belowFloor (6<10, Deckung 90 >= 80) -> []", () => {
  const findings = voiceTariffFloorFindings({
    domesticTariffCents: 6,
    fullCostFloorCents: 10,
    coveragePercent: 90,
    minCoveragePercent: 80,
  });
  assert.deepEqual(findings, []);
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

test("U6: Gleichstand Coverage==Schwelle (80<80 false) -> [] (strikt <, Gleichstand ist erfuellt)", () => {
  const findings = voiceTariffFloorFindings({
    domesticTariffCents: 6,
    fullCostFloorCents: 10,
    coveragePercent: 80,
    minCoveragePercent: 80,
  });
  assert.deepEqual(findings, []);
});

// ---- Boot-Beweis ----

function outboundEndedCall(id, costTruedSource) {
  return seedCall({ id, direction: "outbound", endedAt: new Date().toISOString(), costTruedSource });
}

// 10 beendete Outbound-Calls, davon `proven` mit costTruedSource='telnyx_detail_records'
// (der Rest 'unavailable') - costTruingCoveragePercent liest NUR den Anteil DETAIL_RECORDS.
function tenCallsSeed(proven) {
  const calls = [];
  for (let i = 0; i < 10; i++) {
    calls.push(outboundEndedCall(`call_q_${i}`, i < proven ? "telnyx_detail_records" : "unavailable"));
  }
  return seedState({ calls });
}

test("(p) Tarif 6 < Schwelle 10, Deckung 20% < 80% -> genau EINE WARN-Zeile mit beiden Zahlen, /healthz 200, kein exit", async () => {
  const srv = await startServer({
    env: { VOICE_TARIFF_DOMESTIC_CENTS: "6", VOICE_TARIFF_FULL_COST_FLOOR_CENTS: "10" },
    seed: tenCallsSeed(2),
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

test("(q1) Tarif 6 < Schwelle 10, aber Deckung 90% >= 80% -> keine Meldung (offene Flanke, Vorbedingung 1 nicht eigenstaendig ueberwacht)", async () => {
  const srv = await startServer({
    env: { VOICE_TARIFF_DOMESTIC_CENTS: "6", VOICE_TARIFF_FULL_COST_FLOOR_CENTS: "10" },
    seed: tenCallsSeed(9),
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /Vollkostenschwelle/);
  } finally {
    await srv.stop();
  }
});

test("(q2) Tarif 20 >= Schwelle 10, Deckung 20% < 80% -> keine Meldung (Guard feuert nur in der Konjunktion)", async () => {
  const srv = await startServer({
    env: { VOICE_TARIFF_DOMESTIC_CENTS: "20", VOICE_TARIFF_FULL_COST_FLOOR_CENTS: "10" },
    seed: tenCallsSeed(2),
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
