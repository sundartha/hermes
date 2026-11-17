import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESULT_LIST_MAX_ITEMS,
  RESULT_TEXT_MAX_CHARS,
  normalizeCallResult,
} from "../../src/call-result.ts";

const ARTEN = ["appointment", "callback", "task", "other"];
const norm = (parsed) => normalizeCallResult(parsed, { evidenceAllowed: false });

test("4996: gueltiger Schritt mit Art, Text und Zeitpunkt kommt unveraendert an", () => {
  const card = norm({
    next_steps: [{ type: "appointment", text: "Termin mit Dr. X, bitte in den Kalender eintragen", at: "2026-11-20T10:00" }],
  });
  assert.deepEqual(card.nextSteps, [
    { type: "appointment", text: "Termin mit Dr. X, bitte in den Kalender eintragen", at: "2026-11-20T10:00" },
  ]);
});

test("4996: Schritt allein macht die Karte nicht leer", () => {
  const card = norm({ next_steps: [{ type: "task", text: "Unterlagen schicken", at: null }] });
  assert.notEqual(card, null);
  assert.equal(card.outcome, null);
});

test("4996: keine Schritte -> leere Liste, und ohne weiteren Inhalt keine Karte", () => {
  assert.equal(norm({ next_steps: [] }), null);
  assert.equal(norm({ next_steps: "kein Array" }), null);
  assert.deepEqual(norm({ outcome: "ok" }).nextSteps, []);
  assert.deepEqual(norm({ outcome: "ok", next_steps: "x" }).nextSteps, []);
});

test("4996: Kappung auf Listenobergrenze und Textlaenge", () => {
  const steps = Array.from({ length: 5 }, (_, i) => ({ type: "task", text: `s${i}`, at: null }));
  assert.equal(norm({ next_steps: steps }).nextSteps.length, RESULT_LIST_MAX_ITEMS);
  const schritte = norm({ next_steps: steps }).nextSteps;
  const texte = schritte.map((s) => s.text);
  assert.deepEqual(texte, ["s0", "s1", "s2"]);
  const lang = norm({ next_steps: [{ type: "task", text: `  ${"x".repeat(400)}  `, at: null }] });
  assert.equal(lang.nextSteps[0].text.length, RESULT_TEXT_MAX_CHARS);
});

test("4996: ungueltige Eintraege werden verworfen, Kappung zaehlt nur gueltige", () => {
  const card = norm({
    next_steps: [
      null,
      "text",
      { type: "task" },
      { type: "task", text: "   ", at: null },
      { type: "task", text: 5, at: null },
      { type: "task", text: "a", at: null },
      { type: "task", text: "b", at: null },
      { type: "task", text: "c", at: null },
      { type: "task", text: "d", at: null },
    ],
  });
  assert.deepEqual(card.nextSteps.map((s) => s.text), ["a", "b", "c"]);
});

test("4996: unbekannte oder fehlende Art wird other", () => {
  const card = norm({
    next_steps: [
      { type: "teleport", text: "a", at: null },
      { text: "b", at: null },
      { type: 3, text: "c", at: null },
    ],
  });
  assert.deepEqual(card.nextSteps.map((s) => s.type), ["other", "other", "other"]);
  for (const art of ARTEN) {
    assert.equal(norm({ next_steps: [{ type: art, text: "t" }] }).nextSteps[0].type, art);
  }
});

const zeitpunkte = [
  ["2026-11-20", "2026-11-20"],
  ["2026-11-20T10:00", "2026-11-20T10:00"],
  ["2026-11-20T10:00:30", "2026-11-20T10:00:30"],
  ["2026-11-20T10:00:00Z", "2026-11-20T10:00:00Z"],
  ["2026-11-20T10:00:00+01:00", "2026-11-20T10:00:00+01:00"],
  ["  2026-11-20  ", "2026-11-20"],
  ["20.11. 10:00", null],
  ["morgen", null],
  ["2026-13-40", null],
  ["2026-02-30", null],
  ["2026-11-20T25:00", null],
  ["2026-11-20 10:00", null],
  ["2026-02-28", "2026-02-28"],
  ["2026-02-29", null],
  ["2024-02-29", "2024-02-29"],
  ["2026-04-30", "2026-04-30"],
  ["2026-04-31", null],
  ["2026-01-31", "2026-01-31"],
  ["2026-12-31", "2026-12-31"],
  ["2026-01-01", "2026-01-01"],
  ["2026-00-10", null],
  ["2026-13-10", null],
  ["2026-11-00", null],
  ["2026-11-32", null],
  ["2026-11-20T00:00", "2026-11-20T00:00"],
  ["2026-11-20T23:59:59", "2026-11-20T23:59:59"],
  ["2026-11-20T24:00", null],
  ["2026-11-20T10:60", null],
  ["2026-11-20T10:00:60", null],
  ["2026-11-20T10:00+23:59", "2026-11-20T10:00+23:59"],
  ["2026-11-20T10:00+24:00", null],
  ["2026-11-20T10:00-01:60", null],
  ["2026-11-20T10:00:00-05:00", "2026-11-20T10:00:00-05:00"],
  ["2026-11-20T10", null],
  ["2026-11-20T", null],
  ["x2026-11-20", null],
  ["2026-11-20x", null],
  ["", null],
  [null, null],
  [undefined, null],
  [20261120, null],
];

for (const [eingabe, erwartet] of zeitpunkte) {
  test(`4996: Zeitpunkt ${JSON.stringify(eingabe)} -> ${JSON.stringify(erwartet)}`, () => {
    const card = norm({ next_steps: [{ type: "appointment", text: "t", at: eingabe }] });
    assert.equal(card.nextSteps[0].at, erwartet);
  });
}

test("4996: bestehendes next_step-Einzelfeld bleibt unveraendert", () => {
  const card = norm({ next_step: "Rueckruf am Montag", next_steps: [{ type: "callback", text: "Rueckruf", at: null }] });
  assert.equal(card.nextStep, "Rueckruf am Montag");
});
