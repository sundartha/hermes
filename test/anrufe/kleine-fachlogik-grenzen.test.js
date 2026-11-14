import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCallResult,
  stripResultEvidence,
  resultCardView,
  evidenceRetentionEnabled,
} from "../../src/call-result.ts";
import { memoryLine, budgetedMemoryLines } from "../../src/call-memory.js";

const ohne = { evidenceAllowed: false };

test("Ergebniskarte: jedes Feld allein reicht als Inhalt, leere Felder ergeben keine Karte", () => {
  const felder = [
    [{ outcome: "Ok" }, "outcome", "Ok"],
    [{ commitments: ["a"] }, "commitments", ["a"]],
    [{ counterparty_commitments: ["b"] }, "counterpartyCommitments", ["b"]],
    [{ open_points: ["c"] }, "openPoints", ["c"]],
    [{ next_step: "morgen" }, "nextStep", "morgen"],
    [{ facts: ["d"] }, "facts", ["d"]],
  ];
  for (const [eingabe, schluessel, erwartet] of felder) {
    const karte = normalizeCallResult(eingabe, ohne);
    assert.deepEqual(karte[schluessel], erwartet, schluessel);
  }
  assert.equal(normalizeCallResult({ outcome: "  ", commitments: ["", "  "], next_step: " " }, ohne), null);
  assert.equal(normalizeCallResult({ outcome: 5, commitments: [1, null] }, ohne), null);
  assert.equal(normalizeCallResult(undefined, ohne), null);
  assert.equal(normalizeCallResult(null, { evidenceAllowed: true }), null);
});

test("Ergebniskarte: nur Beleg reicht bei erlaubtem Beleg, leere Belegliste nicht", () => {
  const mitBeleg = normalizeCallResult({ evidence: ["Zitat"] }, { evidenceAllowed: true });
  assert.deepEqual(mitBeleg.evidence, ["Zitat"]);
  assert.equal(normalizeCallResult({ evidence: ["Zitat"] }, ohne), null);
  assert.equal(normalizeCallResult({ evidence: [] }, { evidenceAllowed: true }), null);
  assert.deepEqual(
    normalizeCallResult({ outcome: "x", evidence: [] }, { evidenceAllowed: true }).evidence,
    [],
  );
});

test("Ergebniskarte: Text wird getrimmt und bei 200 Zeichen gekappt, 200 bleibt ganz", () => {
  assert.equal(normalizeCallResult({ outcome: "  hallo  " }, ohne).outcome, "hallo");
  assert.equal(normalizeCallResult({ outcome: "y".repeat(200) }, ohne).outcome.length, 200);
  assert.equal(normalizeCallResult({ next_step: "z".repeat(201) }, ohne).nextStep.length, 200);
  const [fakt] = normalizeCallResult({ facts: ["f".repeat(300)] }, ohne).facts;
  assert.equal(fakt.length, 200);
});

test("Ergebniskarte: Listen nehmen höchstens 3 Einträge, leere zählen nicht mit", () => {
  const karte = normalizeCallResult(
    {
      commitments: ["", "a", " ", "b", "c", "d"],
      counterparty_commitments: ["1", "2", "3", "4"],
      open_points: ["o1", "o2", "o3", "o4"],
      facts: ["f1", "f2", "f3", "f4"],
    },
    ohne,
  );
  assert.deepEqual(karte.commitments, ["a", "b", "c"]);
  assert.deepEqual(karte.counterpartyCommitments, ["1", "2", "3"]);
  assert.deepEqual(karte.openPoints, ["o1", "o2", "o3"]);
  assert.deepEqual(karte.facts, ["f1", "f2", "f3"]);
  assert.deepEqual(normalizeCallResult({ facts: ["a", "b", "c"] }, ohne).facts, ["a", "b", "c"]);
});

test("Ergebniskarte: Belege höchstens 2 mit je 160 Zeichen", () => {
  const karte = normalizeCallResult(
    { evidence: ["e".repeat(160), "f".repeat(161), "g"] },
    { evidenceAllowed: true },
  );
  assert.deepEqual(karte.evidence.map((e) => e.length), [160, 160]);
});

test("Ergebnisbeleg: Aufbewahrung nur bei mehr als 0 Tagen, Entfernen meldet echte Änderung", () => {
  assert.equal(evidenceRetentionEnabled({ evidenceRetentionDays: 1 }), true);
  assert.equal(evidenceRetentionEnabled({ evidenceRetentionDays: 0 }), false);
  assert.equal(evidenceRetentionEnabled({ evidenceRetentionDays: -1 }), false);
  const mit = { result: { outcome: "x", evidence: ["a"] } };
  assert.deepEqual(stripResultEvidence(mit), { outcome: "x" });
  assert.deepEqual(mit.result, { outcome: "x", evidence: ["a"] });
  const ohneBeleg = { result: { outcome: "x" } };
  assert.equal(stripResultEvidence(ohneBeleg), null);
  assert.deepEqual(ohneBeleg.result, { outcome: "x" });
  assert.equal(stripResultEvidence({}), null);
  assert.equal(stripResultEvidence({ result: null }), null);
});

test("Ergebnisansicht: Vorgaben ohne Karte und Umbenennung der Felder", () => {
  assert.deepEqual(resultCardView(undefined), {
    outcome: null,
    commitments: [],
    counterparty_commitments: [],
    open_points: [],
    next_step: null,
  });
  assert.deepEqual(resultCardView(null).commitments, []);
  assert.deepEqual(
    resultCardView({
      outcome: "o",
      commitments: ["c"],
      counterpartyCommitments: ["k"],
      openPoints: ["p"],
      nextStep: "n",
      facts: ["nicht sichtbar"],
    }),
    { outcome: "o", commitments: ["c"], counterparty_commitments: ["k"], open_points: ["p"], next_step: "n" },
  );
});

test("Gedächtniszeile: Grenzen 100 und 200 Zeichen, Trennzeichen und Leerraum", () => {
  assert.equal(memoryLine({ outcome: "a".repeat(100) }), "a".repeat(100));
  assert.equal(memoryLine({ outcome: "a".repeat(101) }), `${"a".repeat(99)}…`);
  assert.equal(memoryLine({ outcome: "  Termin \n  steht  " }), "Termin steht");
  assert.equal(memoryLine({ outcome: "o", facts: ["f1", " ", "f2", 7] }), "o; f1; f2");
  assert.equal(memoryLine({ facts: ["nur", "Fakten"] }), "nur; Fakten");
  const lang = memoryLine({ outcome: "o".repeat(100), facts: ["f".repeat(99)] });
  assert.equal(lang, `${"o".repeat(100)};…`);
  assert.equal(lang.endsWith("…"), true);
  assert.equal(memoryLine({ outcome: "o".repeat(100), facts: ["f".repeat(98)] }).length, 200);
  assert.equal(memoryLine({ outcome: "o".repeat(100), facts: ["f".repeat(98)] }).endsWith("…"), false);
});

test("Gedächtniszeile: ohne Inhalt keine Zeile, Fakten ohne Liste werden ignoriert", () => {
  assert.equal(memoryLine({}), null);
  assert.equal(memoryLine(undefined), null);
  assert.equal(memoryLine({ outcome: 4, facts: "kein Array" }), null);
  assert.equal(memoryLine({ outcome: "x", facts: "kein Array" }), "x");
  assert.equal(memoryLine({ outcome: "x", facts: [] }), "x");
});

test("Gedächtniszeilen: höchstens 3, leere fallen weg, Nicht-Liste ergibt leere Liste", () => {
  const eintraege = [{ outcome: "1" }, {}, { outcome: "2" }, { outcome: "3" }, { outcome: "4" }];
  assert.deepEqual(budgetedMemoryLines(eintraege), ["1", "2", "3"]);
  assert.deepEqual(budgetedMemoryLines([{ outcome: "1" }, { outcome: "2" }, { outcome: "3" }]), ["1", "2", "3"]);
  assert.deepEqual(budgetedMemoryLines("x"), []);
  assert.deepEqual(budgetedMemoryLines(undefined), []);
});
