export const INBOUND_NOTICES = Object.freeze({
  de: "Hinweis: Sie sprechen mit einer KI, das Gespräch wird transkribiert und zusammengefasst.",
  en: "Please note: you are speaking to an AI, and this call is transcribed and summarised.",
  fr: "Information : vous parlez à une IA, cet appel est transcrit et résumé.",
});

const AI_MARKERS = /\b(ki|ai|ia)\b|assistent|assistant/i;
const TRANSCRIPT_MARKERS = /transkri|transcri|aufgezeichnet|aufzeichnung|mitgeschnitt|enregistr|recorded|recording/i;

export function hasInboundNotice(text) {
  return typeof text === "string" && AI_MARKERS.test(text) && TRANSCRIPT_MARKERS.test(text);
}

export function withInboundNotice(text, notice) {
  return hasInboundNotice(text) ? text : `${notice} ${text}`;
}
