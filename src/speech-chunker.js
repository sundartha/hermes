import { shapeChunkForSpeech } from "./speech-shape.js";

export const MIN_SENTENCE_CHARS = 12;

const SENTENCE_END_RE = /[.!?…]+["'»”’)\]]*(?=\s)/g;

function firstCharAfterGap(rest) {
  const match = rest.match(/^\s+(\S)/);
  return match ? match[1] : null;
}

const LIST_MARKER_CHARS = "-*+";

function nextSentenceCut(text) {
  SENTENCE_END_RE.lastIndex = 0;
  for (let match; (match = SENTENCE_END_RE.exec(text)); ) {
    const cut = match.index + match[0].length;
    if (cut < MIN_SENTENCE_CHARS) continue;
    const nextChar = firstCharAfterGap(text.slice(cut));
    if (nextChar === null || LIST_MARKER_CHARS.includes(nextChar)) continue;
    return cut;
  }
  return -1;
}

export function makeSentenceChunker({ onChunk, continuesStream = false }) {
  let buffer = "";
  let eager = true;
  let chunks = 0;
  let received = false;

  function emit(raw) {
    const shaped = shapeChunkForSpeech(raw);
    if (!shaped) return;
    onChunk(chunks === 0 && !continuesStream ? shaped : ` ${shaped}`);
    chunks += 1;
  }

  function drainSentences() {
    for (;;) {
      const cut = nextSentenceCut(buffer);
      if (cut < 0) return;
      emit(buffer.slice(0, cut));
      buffer = buffer.slice(cut);
    }
  }

  return {
    pushText(delta) {
      if (!delta) return;
      received = true;
      buffer += delta;
      if (eager) drainSentences();
    },
    toolUseStarted() {
      eager = false;
    },
    flushRemainder() {
      const rest = buffer;
      buffer = "";
      emit(rest);
    },
    chunkCount: () => chunks,
    receivedText: () => received,
  };
}
