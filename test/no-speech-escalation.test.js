// P3.2 (PLAN-CONVERSATION-QUALITY-V2): noSpeechEscalation ist rein (kein Store, kein I/O) -
// diese Suite prueft die Staffel ohne Server-Spawn. Stub-Locale statt des echten i18n-
// Bundles (P12 Independent: die Werte selbst sind hier irrelevant, nur die Zuordnung
// Stufe->Feld zaehlt).
import { test } from "node:test";
import assert from "node:assert/strict";
import { noSpeechEscalation } from "../src/no-speech-escalation.js";

const STUB_LOCALE = {
  noSpeechReprompt: "A",
  noSpeechRepromptAgain: "B",
  noSpeechFarewell: "C",
};

test("noSpeechEscalation: streak 1 -> Stufe 1 (Rueckfrage, kein Hangup)", () => {
  assert.deepEqual(noSpeechEscalation(1, STUB_LOCALE), { speech: "A", endCall: false });
});

test("noSpeechEscalation: streak 2 -> Stufe 2 (deutlicher, kein Hangup)", () => {
  assert.deepEqual(noSpeechEscalation(2, STUB_LOCALE), { speech: "B", endCall: false });
});

test("noSpeechEscalation: streak 3 -> Stufe 3 (Abschied + Hangup)", () => {
  assert.deepEqual(noSpeechEscalation(3, STUB_LOCALE), { speech: "C", endCall: true });
});

test("noSpeechEscalation: streak 7 (Uebersaettigung, z.B. Provider ignoriert Hangup) -> weiter Stufe 3", () => {
  assert.deepEqual(noSpeechEscalation(7, STUB_LOCALE), { speech: "C", endCall: true });
});
