export function anfrage(url, { fristMs, signal, ...optionen } = {}) {
  return fetch(url, {
    ...optionen,
    signal: AbortSignal.any([AbortSignal.timeout(fristMs), ...(signal ? [signal] : [])]),
  });
}
