import { MS_PER_MINUTE, MS_PER_SECOND } from "../utils/timer.ts";
import { VORSPANN_TTS_FRIST_MS } from "../elevenlabs/vorspann-pruefung.js";

export const ANRUF_STEUERN_FRIST_MS = 8_000;
const BRIEFING_SCHRITTE = 2;
const HOP_PUFFER_SEKUNDEN = 5;
const HOP_PUFFER_MS = HOP_PUFFER_SEKUNDEN * MS_PER_SECOND;

export function placeCallHopFristMs(briefingFristMs: number): number {
  const schritte = BRIEFING_SCHRITTE * briefingFristMs + VORSPANN_TTS_FRIST_MS + ANRUF_STEUERN_FRIST_MS;
  return Math.max(MS_PER_MINUTE, schritte + HOP_PUFFER_MS);
}
