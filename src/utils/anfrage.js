export function anfrage(url, optionen = {}) {
  const { fristMs, signal, ...fetchOptionen } = optionen;
  return fetch(url, {
    ...fetchOptionen,
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(fristMs)]),
  });
}
