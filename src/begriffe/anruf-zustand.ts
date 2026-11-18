export const ANRUF_ZUSTAENDE = ["active", "completed", "failed", "cancelled"] as const;

export type AnrufZustand = (typeof ANRUF_ZUSTAENDE)[number];

export function anrufZustandVon(wert: unknown): AnrufZustand | null {
  return ANRUF_ZUSTAENDE.find((zustand) => zustand === wert) ?? null;
}
