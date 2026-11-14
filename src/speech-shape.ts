import { KLAMMER_GRUPPE } from "./i18n/audio-tags.js";

const SHAPE_STEPS: readonly (readonly [RegExp, string])[] = [
  [KLAMMER_GRUPPE, ""],
  [/^[ \t]*[-*+]\s+/gm, ""],
  [/[*#`]/g, ""],
  [/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])|(?<=\p{N})_(?=\p{N})/gu, ""],
  [/(?<=\d)(?<!\d\s+(?:-\s+)?[\d:.]*)\s+-\s+(?=\d)(?!(?:[:.]?\d)*\s+(?:-\s+)?\d)/g, "-"],
  [/\s+-\s+/g, ", "],
  [/\s+/g, " "],
];

function shapedCore(text: string) {
  const replaced = SHAPE_STEPS.reduce((acc, [pattern, to]) => acc.replace(pattern, to), text);
  return replaced.trim();
}

export function shapeChunkForSpeech(text: string): string {
  if (!text) return text;
  return shapedCore(text);
}

export function shapeForSpeech(text: string): string {
  if (!text) return text;
  const out = shapedCore(text).replace(/[,;:]+$/, "");
  return out && !/[.!?]$/.test(out) ? out + "." : out;
}
