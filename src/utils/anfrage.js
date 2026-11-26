export function anfrage(url, optionen) {
  const { fristMs, signal, ...uebrige } = optionen;
  return fetch(url, {
    ...uebrige,
    signal: AbortSignal.any([AbortSignal.timeout(fristMs), ...(signal ? [signal] : [])]),
  });
}
