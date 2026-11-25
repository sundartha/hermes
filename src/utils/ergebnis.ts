export type Ergebnis<T, F = string> = { ok: true; wert: T } | { ok: false; fehler: F };

export function ok<T>(wert: T): Ergebnis<T, never> {
  return { ok: true, wert };
}

export function fehler<F>(grund: F): Ergebnis<never, F> {
  return { ok: false, fehler: grund };
}
