export const ANTWORTFRIST_MS = 5_000;

function keineAntwort(fristMs = ANTWORTFRIST_MS, anfrage = "", ursache = undefined) {
  const fehler = new Error(`keine Antwort nach ${fristMs} ms${anfrage}`, { cause: ursache });
  if (ursache) fehler.name = "TimeoutError";
  return fehler;
}

export function fristSignal({ wartezeitMs = 0 } = {}) {
  return AbortSignal.timeout(wartezeitMs + ANTWORTFRIST_MS);
}

export function mitAntwortfrist(anfrage, { wartezeitMs = 0 } = {}) {
  anfrage.setTimeout(wartezeitMs + ANTWORTFRIST_MS, () => anfrage.destroy(keineAntwort()));
  return anfrage;
}

export function abrufMitFrist(url, optionen = {}, { wartezeitMs = 0 } = {}) {
  const frist = fristSignal({ wartezeitMs });
  const methode = (optionen.method ?? "GET").toUpperCase();
  return fetch(url, {
    ...optionen,
    signal: AbortSignal.any([frist, ...(optionen.signal ? [optionen.signal] : [])]),
  }).catch((fehler) => {
    if (!frist.aborted || optionen.signal?.aborted) throw fehler;
    throw keineAntwort(wartezeitMs + ANTWORTFRIST_MS, `: ${methode} ${new URL(url).pathname}`, fehler);
  });
}
