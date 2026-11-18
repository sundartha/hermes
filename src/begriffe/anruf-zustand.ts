export const ANRUF_ZUSTAENDE = ["active", "completed", "failed", "cancelled"] as const;

export type AnrufZustand = (typeof ANRUF_ZUSTAENDE)[number];

export function istAnrufZustand(wert: unknown): wert is AnrufZustand {
  return ANRUF_ZUSTAENDE.some((zustand) => zustand === wert);
}
