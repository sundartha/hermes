import { test } from "node:test";
import assert from "node:assert/strict";

import {
  VORSPANN_MIN_BYTES_JE_ZEICHEN,
  VORSPANN_RUECKFALL,
  VORSPANN_TTS_FRIST_MS,
  audioRueckfall,
  eroeffnungRueckfall,
} from "../../src/elevenlabs/vorspann-pruefung.js";

const ZEICHEN = 150;
const PFLICHTSATZ = "Hier spricht eine KI.";
const EROEFFNUNG = { text: `${PFLICHTSATZ} Es geht um X.`, pflichtsatz: PFLICHTSATZ };
const mindestBytes = (zeichen) => Buffer.alloc(VORSPANN_MIN_BYTES_JE_ZEICHEN * zeichen);

test("3365-K5: die Rueckfallgruende und Grenzwerte sind festgeschrieben (sie stehen in Logzeilen und Auswertungen)", () => {
  assert.deepEqual(VORSPANN_RUECKFALL, {
    KEINE_CALL_CONTROL_APP: "keine_call_control_app",
    EROEFFNUNG: "eroeffnung",
    TTS_QUOTE: "tts_quote",
    TTS_FEHLER: "tts_fehler",
    TTS_UNVOLLSTAENDIG: "tts_unvollstaendig",
    TTS_FRIST: "tts_frist",
    TTS_UNPLAUSIBEL: "tts_unplausibel",
  });
  assert.equal(Object.isFrozen(VORSPANN_RUECKFALL), true);
  assert.equal(VORSPANN_TTS_FRIST_MS, 5000);
  assert.equal(VORSPANN_MIN_BYTES_JE_ZEICHEN, 100);
});

const EROEFFNUNGS_TABELLE = [
  ["beginnt mit dem Pflichtsatz", EROEFFNUNG, null],
  ["Text ist genau der Pflichtsatz", { text: PFLICHTSATZ, pflichtsatz: PFLICHTSATZ }, null],
  ["beginnt nicht mit dem Pflichtsatz", { text: `Guten Tag. ${PFLICHTSATZ}`, pflichtsatz: PFLICHTSATZ }, "eroeffnung"],
  ["Pflichtsatz nur am Ende", { text: `Es geht um X. ${PFLICHTSATZ}`, pflichtsatz: PFLICHTSATZ }, "eroeffnung"],
  ["leerer Text", { text: "", pflichtsatz: PFLICHTSATZ }, "eroeffnung"],
  ["leerer Pflichtsatz", { text: "Es geht um X.", pflichtsatz: "" }, "eroeffnung"],
];

for (const [name, eingabe, erwartet] of EROEFFNUNGS_TABELLE)
  test(`3365-K3: Pruefung der Eroeffnung - ${name} -> ${erwartet ?? "kein Rueckfall"}`, () => {
    assert.equal(eroeffnungRueckfall(eingabe), erwartet);
  });

const AUDIO_TABELLE = [
  ["unvollstaendig", { complete: false, bytes: mindestBytes(ZEICHEN) }, "tts_unvollstaendig"],
  ["genau die Mindestgroesse", { complete: true, bytes: mindestBytes(ZEICHEN) }, null],
  ["ein Byte darunter", { complete: true, bytes: mindestBytes(ZEICHEN).subarray(1) }, "tts_unplausibel"],
  ["deutlich darueber", { complete: true, bytes: mindestBytes(ZEICHEN * 2) }, null],
];

for (const [name, audio, erwartet] of AUDIO_TABELLE)
  test(`3365-K5: Pruefung des Audios - ${name} -> ${erwartet ?? "kein Rueckfall"}`, () => {
    assert.equal(audioRueckfall({ audio, zeichen: ZEICHEN }), erwartet);
  });
