export const ANRUF_ZUSTAENDE = ["active", "completed", "failed", "cancelled"] as const;

export type AnrufZustand = (typeof ANRUF_ZUSTAENDE)[number];

export function anrufZustandVon(wert: unknown): AnrufZustand | null {
  return ANRUF_ZUSTAENDE.find((zustand) => zustand === wert) ?? null;
}

interface AnrufAnzeigeFelder {
  status: string;
  answeredAt?: string | null;
  queued?: boolean | null;
}

export function anrufStatusAnzeige(call: AnrufAnzeigeFelder): string {
  if (call.status === "active") return call.answeredAt ? "in_progress" : call.queued ? "queued" : "dialing";
  return call.status;
}
