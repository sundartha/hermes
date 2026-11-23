export const ANRUF_ZUSTAENDE = ["active", "completed", "failed", "cancelled"] as const;

export type AnrufZustand = (typeof ANRUF_ZUSTAENDE)[number];

export function anrufZustandVon(wert: unknown): AnrufZustand | null {
  return ANRUF_ZUSTAENDE.find((zustand) => zustand === wert) ?? null;
}

const endeAnderswoGeschrieben = new WeakSet<object>();

export function merkeEndeAnderswo(call: object): void {
  endeAnderswoGeschrieben.add(call);
}

export function endeLagAnderswo(call: unknown): boolean {
  return typeof call === "object" && call !== null && endeAnderswoGeschrieben.has(call);
}
