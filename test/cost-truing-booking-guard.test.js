import { test } from "node:test";
import assert from "node:assert/strict";
import { costTruingBookingFindings, COST_TRUING_BOOKING_FINDING } from "../src/boot-guard.js";
import {
  ASSIGNABLE_COST_RECORD_TYPES,
  UNASSIGNABLE_COST_RECORD_TYPES,
} from "../src/telephony/adapters/telnyx/voice.js";
import { startServer, startServerExpectExit, outboundCallsSeed } from "./helpers.js";

const ASSIGNABLE = ASSIGNABLE_COST_RECORD_TYPES;
const UNASSIGNABLE = UNASSIGNABLE_COST_RECORD_TYPES;
const NON_ENUM_RECORD_TYPES = Object.freeze(["Inference", "call", "sip_trunking"]);

test("U2: leere Pflicht-Menge (Deckung ueber der Schwelle) -> genau ein Befund, fatal:true", () => {
  const findings = costTruingBookingFindings({
    requiredRecordTypes: [],
    assignableRecordTypes: ASSIGNABLE,
    coveragePercent: 100,
    minCoveragePercent: 80,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, true);
  assert.equal(findings[0].code, COST_TRUING_BOOKING_FINDING.REQUIRED_TYPES_EMPTY);
});

test("U3: Menge gesetzt + 20% vs. 80% -> genau ein Befund, fatal:false", () => {
  const findings = costTruingBookingFindings({
    requiredRecordTypes: ["sip-trunking"],
    assignableRecordTypes: ASSIGNABLE,
    coveragePercent: 20,
    minCoveragePercent: 80,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, false);
  assert.equal(findings[0].code, COST_TRUING_BOOKING_FINDING.COVERAGE_BELOW_THRESHOLD);
});

test("U4: 80% vs. 80% (Gleichstand) -> [] (>=, Gleichstand ist erfuellt)", () => {
  const findings = costTruingBookingFindings({
    requiredRecordTypes: ["sip-trunking"],
    assignableRecordTypes: ASSIGNABLE,
    coveragePercent: 80,
    minCoveragePercent: 80,
  });
  assert.deepEqual(findings, []);
});

test("U5: beide Befunde koennen GEMEINSAM auftreten (leere Menge UND Deckung unter Schwelle)", () => {
  const findings = costTruingBookingFindings({
    requiredRecordTypes: [],
    assignableRecordTypes: ASSIGNABLE,
    coveragePercent: 20,
    minCoveragePercent: 80,
  });
  assert.equal(findings.length, 2);
  const codes = findings.map((f) => f.code).sort();
  assert.deepEqual(codes, [COST_TRUING_BOOKING_FINDING.COVERAGE_BELOW_THRESHOLD, COST_TRUING_BOOKING_FINDING.REQUIRED_TYPES_EMPTY].sort());
});

test("U6: nie zuordenbarer Pflicht-Typ -> fataler Befund, nennt den Typ", () => {
  const findings = costTruingBookingFindings({
    requiredRecordTypes: ["sip-trunking", ...UNASSIGNABLE],
    assignableRecordTypes: ASSIGNABLE,
    coveragePercent: 100,
    minCoveragePercent: 80,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, true);
  assert.equal(findings[0].code, COST_TRUING_BOOKING_FINDING.REQUIRED_TYPES_UNASSIGNABLE);
  for (const t of UNASSIGNABLE) assert.match(findings[0].message, new RegExp(t));
});

test("U6b: Nicht-Enum-Pflicht-Typ (Case-Drift, Tippfehler, nicht existierender Typ) -> fataler Befund", () => {
  for (const bad of NON_ENUM_RECORD_TYPES) {
    const findings = costTruingBookingFindings({
      requiredRecordTypes: ["sip-trunking", bad],
      assignableRecordTypes: ASSIGNABLE,
      coveragePercent: 100,
      minCoveragePercent: 80,
    });
    assert.equal(findings.length, 1, `Wert ${bad}`);
    assert.equal(findings[0].fatal, true, `Wert ${bad}`);
    assert.equal(findings[0].code, COST_TRUING_BOOKING_FINDING.REQUIRED_TYPES_UNASSIGNABLE, `Wert ${bad}`);
    assert.ok(findings[0].message.includes(`fordert ${bad} `), `Wert ${bad} fehlt in: ${findings[0].message}`);
  }
});

test("U7: nur zuordenbare Pflicht-Typen -> kein Unzuordenbar-Befund", () => {
  const findings = costTruingBookingFindings({
    requiredRecordTypes: [...ASSIGNABLE],
    assignableRecordTypes: ASSIGNABLE,
    coveragePercent: 100,
    minCoveragePercent: 80,
  });
  assert.deepEqual(findings, []);
});

test("(n1) leere COST_TRUING_REQUIRED_RECORD_TYPES -> Boot-Refusal, nennt die Env-Var, kein Boot-Banner", async () => {
  const { code, output } = await startServerExpectExit({
    env: { COST_TRUING_REQUIRED_RECORD_TYPES: "" },
  });
  assert.equal(code, 1);
  assert.match(output, /COST_TRUING_REQUIRED_RECORD_TYPES/);
  assert.doesNotMatch(output, /Gateway laeuft/);
});

test("(n2) Gegenprobe: Pflicht-Menge gesetzt -> Server startet", async () => {
  const srv = await startServer({
    env: { COST_TRUING_REQUIRED_RECORD_TYPES: "sip-trunking,call-control" },
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
  } finally {
    await srv.stop();
  }
});

test("(n3) nie zuordenbarer Typ in der Pflicht-Menge -> Boot-Refusal, nennt den Typ, kein Boot-Banner", async () => {
  const { code, output } = await startServerExpectExit({
    env: { COST_TRUING_REQUIRED_RECORD_TYPES: ["sip-trunking", ...UNASSIGNABLE].join(",") },
  });
  assert.equal(code, 1);
  assert.match(output, /COST_TRUING_REQUIRED_RECORD_TYPES/);
  for (const t of UNASSIGNABLE) assert.match(output, new RegExp(t));
  assert.doesNotMatch(output, /Gateway laeuft/);
});

test("(n4) die VOLLE Menge der zuordenbaren Typen als Pflicht-Menge -> Server startet", async () => {
  const srv = await startServer({ env: { COST_TRUING_REQUIRED_RECORD_TYPES: ASSIGNABLE.join(",") } });
  try {
    assert.equal((await fetch(`${srv.localUrl}/healthz`)).status, 200);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
  } finally {
    await srv.stop();
  }
});

test("(p1) 1 von 5 bewiesen (20% < 80%) -> genau EINE WARN-Zeile, /healthz 200, kein Boot-Refusal", async () => {
  const srv = await startServer({
    env: { COST_TRUING_REQUIRED_RECORD_TYPES: "sip-trunking,call-control" },
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
    env: { COST_TRUING_REQUIRED_RECORD_TYPES: "sip-trunking,call-control" },
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
