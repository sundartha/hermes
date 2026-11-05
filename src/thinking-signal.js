import { clampWithoutSplittingRestrictedData } from "./restricted-data.js";
import { shapeForSpeech } from "./speech-shape.js";
import { clampAtWordBoundary } from "./utils/text.js";

export const THINKING_SIGNAL_MAX_CHARS = 120;

const BRIDGE_TAIL_SEPARATOR = " ";

function clampBridge(text) {
  const wordBoundaryCut = clampAtWordBoundary(text, THINKING_SIGNAL_MAX_CHARS).length;
  return clampWithoutSplittingRestrictedData(text, wordBoundaryCut);
}

function bridgeSpeechFrom(roundText) {
  if (typeof roundText !== "string") return "";
  const shaped = shapeForSpeech(clampBridge(roundText.trim()));
  return shaped ? shaped + BRIDGE_TAIL_SEPARATOR : "";
}

export function makeThinkingSignal({ onSpeechChunk, enabled }) {
  let spoken = false;
  return {
    speakBridge(roundText) {
      if (spoken || !enabled || !onSpeechChunk) return "";
      const bridge = bridgeSpeechFrom(roundText);
      if (!bridge) return "";
      onSpeechChunk(bridge);
      spoken = true;
      return bridge.slice(0, bridge.length - BRIDGE_TAIL_SEPARATOR.length);
    },
    spoken: () => spoken,
  };
}
