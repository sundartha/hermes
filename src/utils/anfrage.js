export async function anfrage(url, { fristMs, signal, ...uebrige } = {}) {
  if (!Number.isFinite(fristMs) || fristMs <= 0) {
    throw new TypeError("anfrage: fristMs muss eine positive, endliche Zahl sein");
  }
  return fetch(url, {
    ...uebrige,
    signal: AbortSignal.any([AbortSignal.timeout(fristMs), ...(signal ? [signal] : [])]),
  });
}
