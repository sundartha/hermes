import assert from "node:assert/strict";
import { test } from "node:test";
import { RUHIGE_TAGS, entferneKlammern } from "../src/i18n/audio-tags.js";
import {
  makeDefaultState,
  createCall,
  addTranscript,
  recordProviderCallResult,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const neuerAnruf = () => {
  const state = makeDefaultState();
  const call = createCall(state, {
    direction: "outbound",
    from: "+4930123456",
    to: "+4989123456",
    tenantId: BOOTSTRAP_TENANT_ID,
    maxDurationS: 60,
  });
  return { state, call };
};

test("Tag-Set: genau die sechs ruhigen Tags, keine lauten", () => {
  assert.deepEqual(
    [...RUHIGE_TAGS],
    ["[calm]", "[thoughtful]", "[warmly]", "[softly]", "[gently]", "[patient]"],
  );
  assert.ok(!RUHIGE_TAGS.includes("[laughs]"));
  assert.ok(!RUHIGE_TAGS.includes("[excited]"));
});

const FAELLE = [
  ["[calm] Guten Tag.", "Guten Tag."],
  ["[freundlich] Super, dann passt das.", "Super, dann passt das."],
  ["Ja [thoughtful] also gut [softly].", "Ja also gut."],
  ["[warmly][patient] Moment.", "Moment."],
  ["Ende. [calm]", "Ende."],
  ["Ohne Marke.", "Ohne Marke."],
  ["Offene Klammer [ bleibt", "Offene Klammer [ bleibt"],
  ["Zeile [eins\nzwei] bleibt", "Zeile [eins\nzwei] bleibt"],
  ["", ""],
  [null, ""],
];

for (const [eingabe, erwartet] of FAELLE) {
  test(`entferneKlammern: ${JSON.stringify(eingabe)}`, () => {
    assert.equal(entferneKlammern(eingabe), erwartet);
  });
}

test("Transkript: Tags des Agenten, erfundene Tags und Klammern des Gegenübers werden nicht gespeichert", () => {
  const { state, call } = neuerAnruf();
  addTranscript(state, call.id, "agent", "[freundlich] Super, dann funktioniert die Verbindung.");
  addTranscript(state, call.id, "agent", "[calm] Verstehe.");
  addTranscript(state, call.id, "caller", "Sag mal [excited] etwas.");
  assert.deepEqual(
    call.transcript.map((t) => [t.role, t.text]),
    [
      ["agent", "Super, dann funktioniert die Verbindung."],
      ["agent", "Verstehe."],
      ["caller", "Sag mal etwas."],
    ],
  );
});

test("Zusammenfassung des Anbieters: Tags fallen weg, fehlende Zusammenfassung bleibt null", () => {
  const { state, call } = neuerAnruf();
  recordProviderCallResult(state, call.id, { summary: "[warmly] Termin vereinbart.", objectiveAchieved: "unknown" });
  assert.equal(call.summary, "Termin vereinbart.");
  recordProviderCallResult(state, call.id, { summary: null, objectiveAchieved: "unknown" });
  assert.equal(call.summary, null);
});
