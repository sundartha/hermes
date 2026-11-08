const FRIST_FEHLT = "anfrage: fristMs muss eine positive, endliche Zahl sein";

export function anfrage(url, optionen = {}) {
  const { fristMs, signal, ...fetchOptionen } = optionen;
  if (typeof fristMs !== "number" || !Number.isFinite(fristMs) || fristMs <= 0)
    throw new TypeError(FRIST_FEHLT);
  return fetch(url, {
    ...fetchOptionen,
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(fristMs)]),
  });
}
