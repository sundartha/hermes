interface AnfrageOptionen extends Omit<RequestInit, "signal"> {
  fristMs: number;
  signal?: AbortSignal | null | undefined;
}

export function anfrage(url: string | URL, optionen: AnfrageOptionen): ReturnType<typeof fetch> {
  const { fristMs, signal, ...uebrige } = optionen;
  return fetch(url, {
    ...uebrige,
    signal: AbortSignal.any([AbortSignal.timeout(fristMs), ...(signal ? [signal] : [])]),
  });
}
