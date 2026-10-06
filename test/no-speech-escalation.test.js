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
