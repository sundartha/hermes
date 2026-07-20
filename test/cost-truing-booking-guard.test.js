// LCT P4 (Der Flip): die zwei Boot-Riegel der Korrekturbuchung.
//   (n) Unit: costTruingBookingFindings (src/boot-guard.js) - reine Entscheidung,
//       Muster test/spend-cap-coherence.test.js.
//   (n)+(p) Boot-Beweis: Spawn-Tests, Muster test/provider-rate-guard.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { costTruingBookingFindings, COST_TRUING_BOOKING_FINDING } from "../src/boot-guard.js";
import { startServer, startServerExpectExit, outboundCallsSeed } from "./helpers.js";

// ---- Unit: costTruingBookingFindings ----

test("U1: Buchung AUS -> [] (auch bei leerer Menge UND 0% Deckung)", () => {
  const findings = costTruingBookingFindings({
    bookingEnabled: false,
    requiredRecordTypes: [],
    coveragePercent: 0,
    minCoveragePercent: 80,
  });
  assert.deepEqual(findings, []);
});

test("U2: Buchung AN + leere Pflicht-Menge (Deckung ueber der Schwelle) -> genau ein Befund, fatal:true", () => {
  const findings = costTruingBookingFindings({
    bookingEnabled: true,
    requiredRecordTypes: [],
    coveragePercent: 100,
    minCoveragePercent: 80,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, true);
  assert.equal(findings[0].code, COST_TRUING_BOOKING_FINDING.REQUIRED_TYPES_EMPTY);
});

test("U3: Buchung AN + Menge gesetzt + 20% vs. 80% -> genau ein Befund, fatal:false", () => {
  const findings = costTruingBookingFindings({
    bookingEnabled: true,
    requiredRecordTypes: ["sip-trunking"],
    coveragePercent: 20,
    minCoveragePercent: 80,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, false);
  assert.equal(findings[0].code, COST_TRUING_BOOKING_FINDING.COVERAGE_BELOW_THRESHOLD);
});

test("U4: Buchung AN + 80% vs. 80% (Gleichstand) -> [] (>=, Gleichstand ist erfuellt)", () => {
  const findings = costTruingBookingFindings({
    bookingEnabled: true,
    requiredRecordTypes: ["sip-trunking"],
    coveragePercent: 80,
    minCoveragePercent: 80,
  });
  assert.deepEqual(findings, []);
});

test("U5: beide Befunde koennen GEMEINSAM auftreten (leere Menge UND Deckung unter Schwelle)", () => {
  const findings = costTruingBookingFindings({
    bookingEnabled: true,
    requiredRecordTypes: [],
    coveragePercent: 20,
    minCoveragePercent: 80,
  });
  assert.equal(findings.length, 2);
  const codes = findings.map((f) => f.code).sort();
  assert.deepEqual(codes, [COST_TRUING_BOOKING_FINDING.COVERAGE_BELOW_THRESHOLD, COST_TRUING_BOOKING_FINDING.REQUIRED_TYPES_EMPTY].sort());
});

// ---- (n) Boot-Refusal: leere Pflicht-Menge bei aktiver Buchung ----

test("(n1) COST_TRUING_BOOKING_ENABLED=true + leere COST_TRUING_REQUIRED_RECORD_TYPES -> Boot-Refusal, nennt die Env-Var, kein Boot-Banner", async () => {
  const { code, output } = await startServerExpectExit({
    env: { COST_TRUING_BOOKING_ENABLED: "true", COST_TRUING_REQUIRED_RECORD_TYPES: "" },
  });
  assert.equal(code, 1);
  assert.match(output, /COST_TRUING_REQUIRED_RECORD_TYPES/);
  assert.doesNotMatch(output, /Gateway laeuft/);
});

test("(n2) Gegenprobe: Pflicht-Menge gesetzt -> Server startet trotz aktiver Buchung", async () => {
  const srv = await startServer({
    env: {
      COST_TRUING_BOOKING_ENABLED: "true",
      COST_TRUING_REQUIRED_RECORD_TYPES: "sip-trunking,call-control",
    },
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
  } finally {
    await srv.stop();
  }
});

// ---- (p) Deckungsquote-WARN am Boot: genau eine Zeile, kein Boot-Refusal ----
// Seed-Bauer outboundCallsSeed (G5): geteilt mit voice-tariff-full-cost-guard.test.js,
// definiert in test/helpers.js. 5 Calls, davon `proven` bewiesen, IDs mit Praefix call_p_.

test("(p1) 1 von 5 bewiesen (20% < 80%) -> genau EINE WARN-Zeile, /healthz 200, kein Boot-Refusal", async () => {
  const srv = await startServer({
    env: { COST_TRUING_BOOKING_ENABLED: "true", COST_TRUING_REQUIRED_RECORD_TYPES: "sip-trunking,call-control" },
    seed: outboundCallsSeed(5, 1, "call_p_"),
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    const matches = srv.stdout.match(/Deckungsquote 20% liegt unter/g);
    assert.equal(matches ? matches.length : 0, 1, `erwartet genau eine WARN-Zeile, Output:\n${srv.stdout}`);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
  } finally {
    await srv.stop();
  }
});

test("(p2) 5 von 5 bewiesen (100%) -> keine Deckungs-WARN", async () => {
  const srv = await startServer({
    env: { COST_TRUING_BOOKING_ENABLED: "true", COST_TRUING_REQUIRED_RECORD_TYPES: "sip-trunking,call-control" },
    seed: outboundCallsSeed(5, 5, "call_p_"),
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /Deckungsquote/);
  } finally {
    await srv.stop();
  }
});

test("(p3) Buchung AUS bei 20% Deckung -> keine Deckungs-WARN (der Riegel haengt an bookingEnabled)", async () => {
  const srv = await startServer({
    env: { COST_TRUING_BOOKING_ENABLED: "false", COST_TRUING_REQUIRED_RECORD_TYPES: "sip-trunking,call-control" },
    seed: outboundCallsSeed(5, 1, "call_p_"),
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /Deckungsquote/);
  } finally {
    await srv.stop();
  }
});
