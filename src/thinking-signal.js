// AL-P7b (PLAN-ASSISTANT-LEAP.md, Phase 7b, Weg A): das Denk-Signal. Der Agent sagt einen
// kurzen, zum Gespraech passenden Satz, WAEHREND er arbeitet - statt den Anrufer auf eine
// tote Leitung hoeren zu lassen.
//
// WEG A, gemessen entschieden (AL-P2: Telnyx konsumiert SSE inkrementell): der Satz ist
// der FUEHRENDE TEXT DES MODELLS im selben Antwort-Block wie der Werkzeugaufruf. Er
// kostet deshalb KEINEN zusaetzlichen Roundtrip und steht ohne Zutun in der
// Gespraechssprache und im Kontext. Die Saetze aus src/i18n/locales.js sind hier bewusst
// NICHT die Quelle (das war Weg B, ersatzlos entfallen) - die Sprachbindung traegt der
// Prompt-Sprachvertrag (loc.prompt.thinkingSignal).
//
// KEIN eigener Sprechkanal: der Satz geht ueber DENSELBEN Abnehmer wie die Antwort
// (onSpeechChunk -> derselbe SSE-Strom). Genau daraus folgt die wichtigste Zusage der
// Phase - der Ueberbrueckungssatz wird IMMER zu Ende gesprochen, weil die Antwort ein
// SPAETERES Delta desselben Stroms ist und ihn strukturell nicht unterbrechen kann.
import { shapeForSpeech } from "./speech-shape.js";
import { clampAtWordBoundary } from "./utils/text.js";

// Obergrenze der Ueberbrueckung in Zeichen (G25). Der Prompt verlangt EINEN kurzen Satz;
// diese Zahl ist die Notbremse, nicht der Normalfall. Herleitung: bei der in AL-P1 an
// echten Aufnahmen gemessenen LANGSAMSTEN Sprechrate (17,3 Zeichen/s, s. Kalibrierung in
// src/telnyx-conversation-watchdog.js) sind 120 Zeichen ~7 s Sprechzeit - laenger darf eine
// Ueberbrueckung nie werden, sonst ueberbrueckt sie nicht mehr, sondern haelt auf.
// Bewusst KEINE Env-Variable (G35): kein Betriebsfall braucht sie zur Laufzeit anders.
export const THINKING_SIGNAL_MAX_CHARS = 120;

// Trennzeichen zum NAECHSTEN Inhalt desselben Stroms. Der Abnehmer haengt die Deltas ROH
// aneinander (OpenAI-Delta-Semantik, s. src/speech-chunker.js) - ohne dieses Zeichen
// klebte die Antwort am Ueberbrueckungssatz ("Einen Moment.Ja, Donnerstag passt.").
// Die Ueberbrueckung ist immer das ERSTE Fragment, deshalb steht das Zeichen HINTEN
// (der Chunker setzt es aus demselben Grund vorne).
const BRIDGE_TAIL_SEPARATOR = " ";

// Der sprechbare Ueberbrueckungssatz aus dem fuehrenden Rundentext - oder "" (nichts zu
// sagen). Rein (N7). shapeForSpeech ist derselbe Shaper wie fuer den Turn-Text (G5): er
// raeumt Markdown/Aufzaehlungen ab und sichert das Satzende, das die TTS braucht.
export function bridgeSpeechFrom(roundText) {
  if (typeof roundText !== "string") return "";
  const shaped = shapeForSpeech(clampAtWordBoundary(roundText.trim(), THINKING_SIGNAL_MAX_CHARS));
  return shaped ? shaped + BRIDGE_TAIL_SEPARATOR : "";
}

/**
 * Das Denk-Signal EINES Turns. Haelt den Einmal-pro-Turn-Riegel ("ein Agent, der vor jedem
 * Satz 'einen Moment' sagt, ist schlimmer als einer, der schweigt").
 *
 * @param {{ onSpeechChunk?: (text: string) => void, enabled: boolean }} deps
 *   onSpeechChunk fehlt auf dem Budget-Engine-Pfad (routes/voice.js reicht keinen durch)
 *   -> das Signal ist dort strukturell ein No-op, ganz ohne Flag.
 * @returns {{ speakBridge(roundText: string): boolean, spoken(): boolean }}
 */
export function makeThinkingSignal({ onSpeechChunk, enabled }) {
  let spoken = false;
  return {
    // Nebeneffekt im Namen (N7): schreibt auf die Leitung. true = es wurde gesprochen.
    // Fail-closed in dieser Reihenfolge: Einmal-Riegel, Flag, Abnehmer, Inhalt.
    speakBridge(roundText) {
      if (spoken || !enabled || !onSpeechChunk) return false;
      const bridge = bridgeSpeechFrom(roundText);
      if (!bridge) return false;
      onSpeechChunk(bridge);
      spoken = true;
      return true;
    },
    spoken: () => spoken,
  };
}
