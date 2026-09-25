// EINE Attrappe fuer die GESTREAMTE ElevenLabs-Antwort (IE7). Geteilt von
// test/tts-synth.test.js, test/directive-synth.test.js, test/tts-quota-counter.test.js,
// test/ip4-tts-kontingent.test.js und test/helpers/play-tts-stimm-probe.mjs. Vier Kopien
// wuerden driften - und driftet eine, misst genau eine Suite still nicht mehr.
//
// Kein Timer, keine Uhr: das Halten des Stroms steuert der Test von Hand ueber restGate
// (P12/F.I.R.S.T.).

// Erstes Paket mit "ID3"-Praefix (wie eine echte mp3-Antwort beginnt) und ein beliebiger
// Rest - die Bytewerte selbst sind ohne Bedeutung, nur ihre Trennung zaehlt. Als Text
// kodiert statt als Zahlenliste: so steht der Sinn da, nicht eine Reihe nackter Bytes.
const BYTES = new TextEncoder();
export const FAKE_FIRST_CHUNK = BYTES.encode("ID3");
export const FAKE_REST_CHUNK = BYTES.encode("rest");

const DEFAULT_CONTENT_TYPE = "audio/mpeg";

/** Ein von Hand steuerbares Versprechen fuer restGate. */
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Ein restGate, das der Test ablehnt, ist ein ERWARTETER Fall (Strom bricht ab). Ohne
  // diesen No-op-Fang meldete Node eine unbehandelte Ablehnung, bevor synth.js liest.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

// Liest die Pakete der Reihe nach. restGate haelt ALLES NACH dem ersten Paket zurueck,
// bis es aufloest; lehnt es ab, bricht der Strom nach dem ersten Paket ab.
function makeReader({ chunks, restGate }) {
  let i = 0;
  return {
    async read() {
      if (i === 0) return { done: false, value: chunks[i++] };
      if (restGate) await restGate;
      if (i >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: chunks[i++] };
    },
  };
}

/**
 * Antwort-Attrappe mit lesbarem Strom (res.body.getReader()).
 * @param {{chunks?: Uint8Array[], contentType?: string, restGate?: Promise<void>}} opts
 *   chunks leer -> der Strom endet sofort (done:true beim ersten read, kein erstes Paket).
 * @returns {object} fetch-Response-Form
 */
export function fakeTtsStreamResponse(opts = {}) {
  const chunks = opts.chunks ?? [FAKE_FIRST_CHUNK, FAKE_REST_CHUNK];
  const contentType = opts.contentType ?? DEFAULT_CONTENT_TYPE;
  return {
    ok: true,
    headers: { get: () => contentType },
    body: {
      getReader: () =>
        chunks.length === 0
          ? { read: async () => ({ done: true, value: undefined }) }
          : makeReader({ chunks, restGate: opts.restGate }),
    },
  };
}

/**
 * fetch-Ersatz, der jeden Aufruf aufzeichnet und die Attrappe liefert.
 * @param {object} opts wie fakeTtsStreamResponse
 * @returns {{urls: string[], calls: unknown[][], fetchImpl: Function}}
 */
export function recordingStreamFetch(opts = {}) {
  const urls = [];
  const calls = [];
  const fetchImpl = async (...args) => {
    urls.push(args[0]);
    calls.push(args);
    return fakeTtsStreamResponse(opts);
  };
  return { urls, calls, fetchImpl };
}
