export const ANTWORTFRIST_MS = 15_000;

function keineAntwort() {
  return new Error(`keine Antwort nach ${ANTWORTFRIST_MS} ms`);
}

export function mitAntwortfrist(anfrage) {
  anfrage.setTimeout(ANTWORTFRIST_MS, () => anfrage.destroy(keineAntwort()));
  return anfrage;
}

export function abrufMitFrist(url, optionen = {}) {
  return fetch(url, { ...optionen, signal: AbortSignal.timeout(ANTWORTFRIST_MS) });
}
