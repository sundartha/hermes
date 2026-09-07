// P7 (PLAN-ANRUFDEFEKTE.md, W6): pinnt die EINE Stellschraube dieser Phase -
// turn_eagerness:"patient" - und die Enge ihres Besitzes.
//  - P7 aendert genau EINE Anbieter-Stellschraube (tasks/p7-spec.md, E-1). Ohne Pin
//    ist "genau eine" eine Behauptung ueber einen Diff, den in einem Jahr niemand mehr
//    sieht.
//  - Kein Netz, kein Konto: geprueft wird die Vorlage im Repo. Ob Vorlage und Live-Agent
//    uebereinstimmen, ist Sache von npm run elevenlabs:drift (Abnahme 2).
//  - WARUM eine eigene Datei und kein gemeinsamer Helfer mit el-stimme-abnahme.test.js:
//    jener Pin ist abgenommen und auf soft_timeout_config.<blatt> fest verdrahtet; ihn zu
//    verallgemeinern hiesse, eine abgenommene Datei ausserhalb dieser Phase anzufassen
//    (tasks/p7-spec.md, ABGRENZUNG).
//  - WARUM die Pfadliste hier haendisch steht: sie ist der SOLL-Zustand, nicht
//    Buchhaltung ueber den Ist-Zustand. Eine spaetere Phase, die vad/asr in Besitz
//    nimmt, MUSS diesen Pin dabei mitziehen - genau das ist der Zweck (Lehre
//    i18n-w2-wave-complete: Buchhaltung ersetzt ein Gate nur, wenn der Test den
//    SOLL-Zustand pinnt).
//
// BEWUSST NICHT HIER GEPRUEFT:
//  - transcribe_on_disabled_interruptions === false und
//    disable_first_message_interruptions === true (I-4): das leisten bereits
//    test/elevenlabs-anrufstart.test.js (EL-START T5) und test/el-stimme-abnahme.test.js;
//    eine zweite Kopie waere Duplizierung (G5).
//  - das Anbieter-Enum patient|normal|eager als Assertion: das Schema liegt nicht im
//    Repo, eine abgeschriebene Enum-Liste waere eine zweite, driftende Wahrheit. Der
//    Beleg steht als Quellenangabe im _hinweis der Vorlage.
//  - jeder Netzzugriff (I-1: push-elevenlabs.mjs bleibt in jeder Aufrufform gesperrt,
//    auch der Trockenlauf).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ART_WERT, VORLAGE_REL, wertAnPfad } from "../scripts/lib/elevenlabs-besitz.mjs";

const FELD = "turn_eagerness";
const SOLL_WERT = "patient"; // Anbieter-Enum TurnEagerness: patient | normal | eager
const RUECKFALL_WERT = "normal"; // live gemessen, tasks/p7-vorher-messung.md (E-3)
const VORLAGE_PFAD = "agent.conversation_config.turn.turn_eagerness";
const LIVE_PFAD = "conversation_config.turn.turn_eagerness";

// Der SOLL-Umfang des Besitzes unter turn/vad/asr NACH P7 (E-2, Fail-safe-Bedingung -
// Blocker bei Verletzung, s. tasks/p7-spec.md).
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
  // Gegenprobe: der Fall unterscheidet wirklich vom Rueckfallwert, nicht nur vom Fehlen.
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
