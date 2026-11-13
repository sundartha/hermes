import { shapeForSpeech } from "./speech-shape.js";
import { clampAtWordBoundary } from "./utils/text.ts";

export const THINKING_SIGNAL_MAX_CHARS = 120;

const sprechform: (text: string) => string = shapeForSpeech;

const BRIDGE_TAIL_SEPARATOR = " ";

function bridgeSpeechFrom(roundText: unknown): string {
  if (typeof roundText !== "string") return "";
  const shaped = sprechform(clampAtWordBoundary(roundText.trim(), THINKING_SIGNAL_MAX_CHARS));
  return shaped ? shaped + BRIDGE_TAIL_SEPARATOR : "";
}

interface Denksignal {
  speakBridge: (roundText: unknown) => string;
  spoken: () => boolean;
}

export function makeThinkingSignal({
  onSpeechChunk,
  enabled,
}: {
  onSpeechChunk?: ((stueck: string) => void) | null | undefined;
  enabled: boolean;
}): Denksignal {
  let spoken = false;
  return {
    speakBridge(roundText: unknown): string {
      if (spoken || !enabled || !onSpeechChunk) return "";
      const bridge = bridgeSpeechFrom(roundText);
      if (!bridge) return "";
      onSpeechChunk(bridge);
      spoken = true;
      return bridge.slice(0, bridge.length - BRIDGE_TAIL_SEPARATOR.length);
    },
    spoken: (): boolean => spoken,
  };
}
