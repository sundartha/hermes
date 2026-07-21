// LCT P4 (Der Flip): die zwei Boot-Riegel der Korrekturbuchung.
//   (n) Unit: costTruingBookingFindings (src/boot-guard.js) - reine Entscheidung,
//       Muster test/spend-cap-coherence.test.js.
//   (n)+(p) Boot-Beweis: Spawn-Tests, Muster test/provider-rate-guard.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { costTruingBookingFindings, COST_TRUING_BOOKING_FINDING } from "../src/boot-guard.js";
import {
  ASSIGNABLE_COST_RECORD_TYPES,
  UNASSIGNABLE_COST_RECORD_TYPES,
} from "../src/telephony/adapters/telnyx/voice.js";
import { startServer, startServerExpectExit, outboundCallsSeed } from "./helpers.js";

// Zuordenbare und nie zuordenbare Typen kommen aus DEN Quellen, die der Boot auch verdrahtet
// (G5) - eine im Test wiederholte Literal-Liste koennte davon abdriften.
const ASSIGNABLE = ASSIGNABLE_COST_RECORD_TYPES;
const UNASSIGNABLE = UNASSIGNABLE_COST_RECORD_TYPES;
// Werte, die KEIN realer record_type sind und die eine reine Deny-Liste durchliesse: die
// Schreibvariante eines echten Typs und der laut Telnyx-Messung nicht existierende "call"
// (HTTP 400). Ihr Schaden ist derselbe wie beim strukturell unzuordenbaren Typ.
const NON_ENUM_RECORD_TYPES = Object.freeze(["Inference", "call", "sip_trunking"]);

// ---- Unit: costTruingBookingFindings ----

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

// ---- LCT-FIX-1: unerfuellbare Pflicht-Menge (nie zuordenbarer Typ) ----
// ROT VOR DEM FIX: ohne den Riegel liefert die erste Assertion [] - die Menge sieht gesund
// aus, waehrend jeder Call dauerhaft 'incomplete' bliebe (keine Rueckerstattung mehr, jede
// Nachforderung gebucht).

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

// ROT VOR DEM FIX (Runde 2): der Guard prueft gegen eine Deny-Liste, also passiert JEDER
// Wert, der kein realer record_type ist - mit exakt demselben Schaden wie der strukturell
// unzuordenbare Typ (Pflicht-Menge dauerhaft unerfuellbar, cost-truing.js vergleicht exakt).
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
    // Der beanstandete Wert selbst muss die Meldung anfuehren - ein blosses Vorkommen von
    // "call" kaeme auch ueber das mitgelistete "call-control" durch und pruefte nichts.
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

// ---- (n) Boot-Refusal: leere Pflicht-Menge (die Korrekturbuchung ist unkonditional aktiv) ----

test("(n1) leere COST_TRUING_REQUIRED_RECORD_TYPES -> Boot-Refusal, nennt die Env-Var, kein Boot-Banner", async () => {
  const { code, output } = await startServerExpectExit({
    env: { COST_TRUING_REQUIRED_RECORD_TYPES: "" }, // ueberschreibt den nicht-leeren BASE_ENV-Default
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

// LCT-FIX-1: derselbe Riegel am echten Boot. Die Menge ist NICHT leer und saehe damit im
// Bestands-Guard gesund aus - genau der Fall, den ein frischer Live-Beleg (er enthaelt
// inference-Records) beim ungefilterten Uebernehmen erzeugt.
test("(n3) nie zuordenbarer Typ in der Pflicht-Menge -> Boot-Refusal, nennt den Typ, kein Boot-Banner", async () => {
  const { code, output } = await startServerExpectExit({
    env: { COST_TRUING_REQUIRED_RECORD_TYPES: ["sip-trunking", ...UNASSIGNABLE].join(",") },
  });
  assert.equal(code, 1);
  assert.match(output, /COST_TRUING_REQUIRED_RECORD_TYPES/);
  for (const t of UNASSIGNABLE) assert.match(output, new RegExp(t));
  assert.doesNotMatch(output, /Gateway laeuft/);
});

// ---- (p) Deckungsquote-WARN am Boot: genau eine Zeile, kein Boot-Refusal ----
// Seed-Bauer outboundCallsSeed (G5): geteilt mit voice-tariff-full-cost-guard.test.js,
// definiert in test/helpers.js. 5 Calls, davon `proven` bewiesen, IDs mit Praefix call_p_.

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
