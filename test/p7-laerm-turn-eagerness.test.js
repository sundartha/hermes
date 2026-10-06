import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ART_WERT, VORLAGE_REL, wertAnPfad } from "../scripts/lib/elevenlabs-besitz.mjs";

const FELD = "turn_eagerness";
const SOLL_WERT = "patient";
const RUECKFALL_WERT = "normal";
const VORLAGE_PFAD = "agent.conversation_config.turn.turn_eagerness";
const LIVE_PFAD = "conversation_config.turn.turn_eagerness";

const TURN_PRAEFIX = "conversation_config.turn.";
const VAD_ASR_PRAEFIXE = ["conversation_config.vad", "conversation_config.asr"];
const BESESSENE_TURN_PFADE = [
  "conversation_config.turn.silence_end_call_timeout",
  "conversation_config.turn.soft_timeout_config.additional_soft_timeout_messages",
  "conversation_config.turn.soft_timeout_config.llm_generated_message_prompt_override",
  "conversation_config.turn.soft_timeout_config.max_soft_timeouts_per_generation",
  "conversation_config.turn.soft_timeout_config.message",
  "conversation_config.turn.soft_timeout_config.use_llm_generated_message",
  "conversation_config.turn.transcribe_on_disabled_interruptions",
  "conversation_config.turn.turn_eagerness",
  "conversation_config.turn.turn_timeout",
].sort();

function vorlage() {
  return JSON.parse(readFileSync(new URL(`../${VORLAGE_REL}`, import.meta.url), "utf8"));
}

function besitzFelder(vorlagenInhalt) {
  return vorlagenInhalt._besitz?.felder ?? [];
}

function eintragZu(vorlagenInhalt, feld) {
  return besitzFelder(vorlagenInhalt).find((eintrag) => eintrag.feld === feld) ?? null;
}

function livePfade(vorlagenInhalt) {
  return besitzFelder(vorlagenInhalt).flatMap((eintrag) => eintrag.live ?? []);
}

test('P7-1: die Vorlage traegt turn_eagerness = "patient"', () => {
  const treffer = wertAnPfad(vorlage(), VORLAGE_PFAD);
  assert.equal(treffer.gefunden, true);
  assert.equal(treffer.wert, SOLL_WERT);
  assert.notEqual(treffer.wert, RUECKFALL_WERT);
});

test("P7-2: turn_eagerness steht als art-\"wert\"-Eintrag im Besitz, ohne Ausnahme", () => {
  const eintrag = eintragZu(vorlage(), FELD);
  assert.ok(eintrag, `Besitz-Eintrag fuer ${FELD} fehlt`);
  assert.equal(eintrag.art, ART_WERT);
  assert.deepEqual(eintrag.vorlage, [VORLAGE_PFAD]);
  assert.deepEqual(eintrag.live, [LIVE_PFAD]);
  assert.equal(eintrag.ausgenommen, undefined);
  assert.match(eintrag._hinweis, new RegExp(RUECKFALL_WERT));
});

test("P7-3: der Besitz bleibt eng - kein weiteres Feld unter turn/vad/asr", () => {
  const pfade = livePfade(vorlage());
  const besesseneTurnPfade = pfade.filter((pfad) => pfad.startsWith(TURN_PRAEFIX)).sort();
  assert.deepEqual(besesseneTurnPfade, BESESSENE_TURN_PFADE);

  const besesseneVadAsrPfade = pfade.filter((pfad) =>
    VAD_ASR_PRAEFIXE.some((praefix) => pfad.startsWith(praefix)),
  );
  assert.deepEqual(besesseneVadAsrPfade, []);
});
