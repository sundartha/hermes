import assert from "node:assert/strict";
import { test } from "node:test";
import { ANSWERED_BY, classifyAnsweredBy } from "../../src/telephony/answered-by.ts";
import { noSpeechEscalation } from "../../src/no-speech-escalation.ts";

const ZAHL_STATT_TOKEN = 42;
const ZWEITE_STILLE = 2;
const DRITTE_STILLE = 3;
const SIEBTE_STILLE = 7;

test("eindeutige Maschinen-Token -> MACHINE", () => {
  for (const token of [
    "machine_start",
    "machine_end_beep",
    "machine_end_silence",
    "machine_end_other",
    "fax",
  ]) {
    assert.equal(classifyAnsweredBy(token), ANSWERED_BY.MACHINE, `${token} muss MACHINE liefern`);
  }
});

test("human -> HUMAN", () => {
  assert.equal(classifyAnsweredBy("human"), ANSWERED_BY.HUMAN);
});

test("alles andere (fehlend/unbekannt) -> UNKNOWN (fail-open)", () => {
  for (const raw of ["", undefined, "weird", null, "MACHINE_START", ZAHL_STATT_TOKEN, {}]) {
    assert.equal(
      classifyAnsweredBy(raw),
      ANSWERED_BY.UNKNOWN,
      `${JSON.stringify(raw)} muss UNKNOWN liefern`,
    );
  }
});

const STUB_LOCALE = {
  noSpeechReprompt: "A",
  noSpeechRepromptAgain: "B",
  noSpeechFarewell: "C",
};

test("noSpeechEscalation: streak 1 -> Stufe 1 (Rueckfrage, kein Hangup)", () => {
  assert.deepEqual(noSpeechEscalation(1, STUB_LOCALE), { speech: "A", endCall: false });
});

test("noSpeechEscalation: streak 2 -> Stufe 2 (deutlicher, kein Hangup)", () => {
  assert.deepEqual(noSpeechEscalation(ZWEITE_STILLE, STUB_LOCALE), { speech: "B", endCall: false });
});

test("noSpeechEscalation: streak 3 -> Stufe 3 (Abschied + Hangup)", () => {
  assert.deepEqual(noSpeechEscalation(DRITTE_STILLE, STUB_LOCALE), { speech: "C", endCall: true });
});

test("noSpeechEscalation: streak 7 (Uebersaettigung, z.B. Provider ignoriert Hangup) -> weiter Stufe 3", () => {
  assert.deepEqual(noSpeechEscalation(SIEBTE_STILLE, STUB_LOCALE), { speech: "C", endCall: true });
});
