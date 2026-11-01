import { echtWarten } from "../echt-warten.js";

const KURZE_WARTEZEIT_MS = 20;

export async function mitKurzerFrist(run) {
  const original = AbortSignal.timeout;
  const fristen = [];
  AbortSignal.timeout = (ms) => {
    fristen.push(ms);
    const abbruch = new AbortController();
    echtWarten(KURZE_WARTEZEIT_MS).then(() =>
      abbruch.abort(new DOMException("Die Frist ist abgelaufen", "TimeoutError")),
    );
    return abbruch.signal;
  };
  try {
    await run();
  } finally {
    AbortSignal.timeout = original;
  }
  return fristen;
}

export function antwortetNie(_url, init = {}) {
  if (!init.signal) return Promise.reject(new Error("Anfrage ohne Antwortfrist hängt endlos"));
  return new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
  });
}
