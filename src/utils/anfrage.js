export function anfrage(url, { fristMs, ...optionen } = {}) {
  return fetch(url, { ...optionen, signal: AbortSignal.timeout(fristMs) });
}
