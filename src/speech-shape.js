function shapedCore(text) {
  return (
    text
      .replace(/^[ \t]*[-*+]\s+/gm, "")
      .replace(/[*_#`]/g, "")
      .replace(/\s+-\s+/g, ", ")
      .replace(/\s+/g, " ")
      .trim()
  );
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
