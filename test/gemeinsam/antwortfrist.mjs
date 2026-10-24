export const ANTWORTFRIST_MS = 5_000;

function keineAntwort() {
  return new Error(`keine Antwort nach ${ANTWORTFRIST_MS} ms`);
}

export function fristSignal({ wartezeitMs = 0 } = {}) {
  return AbortSignal.timeout(wartezeitMs + ANTWORTFRIST_MS);
}

export function mitAntwortfrist(anfrage, { wartezeitMs = 0 } = {}) {
  anfrage.setTimeout(wartezeitMs + ANTWORTFRIST_MS, () => anfrage.destroy(keineAntwort()));
  return anfrage;
}

export function abrufMitFrist(url, optionen = {}, { wartezeitMs = 0 } = {}) {
  return fetch(url, {
    ...optionen,
    signal: AbortSignal.any([
      fristSignal({ wartezeitMs }),
      ...(optionen.signal ? [optionen.signal] : []),
    ]),
  });
}
