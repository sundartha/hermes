const SHAPE_STEPS = [
  [/^[ \t]*[-*+]\s+/gm, ""],
  [/[*#`]/g, ""],
  [/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])|(?<=\p{N})_(?=\p{N})/gu, ""],
  [/\s+-\s+/g, ", "],
  [/\s+/g, " "],
];

function shapedCore(text) {
  const replaced = SHAPE_STEPS.reduce((acc, [pattern, to]) => acc.replace(pattern, to), text);
  return replaced.trim();
}

export function shapeChunkForSpeech(text) {
  if (!text) return text;
  return shapedCore(text);
}

export function shapeForSpeech(text) {
  if (!text) return text;
  const out = shapedCore(text).replace(/[,;:]+$/, "");
  return out && !/[.!?]$/.test(out) ? out + "." : out;
}
