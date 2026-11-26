import type { GegenseitenUrteil } from "../call-result.ts";

export const BESTAETIGUNGS_KLAUSEL =
  ' Ergaenze ausserdem "confirmed_by_counterparty" (true nur, wenn die Gegenseite das Ergebnis AUSDRUECKLICH bestaetigt hat, z.B. "ja, Dienstag um 10 Uhr passt"; sonst false), "confirmation_quote" (das woertliche Zitat der Gegenseite aus dem Transkript, das die Bestaetigung belegt, sonst null) und "declined" (true nur, wenn die Gegenseite den Auftrag ausdruecklich abgelehnt hat, sonst false). Eine Zusage des Assistenten oder ein Schweigen der Gegenseite ist keine Bestaetigung.';

interface ModellAntwort {
  confirmed_by_counterparty?: unknown;
  confirmation_quote?: unknown;
  declined?: unknown;
}

interface Zeile {
  role?: string;
  text?: string;
}

const AGENT_ROLE = "agent";

function normalisiert(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function zitatBelegt(zitat: unknown, transcript: readonly Zeile[]): boolean {
  if (typeof zitat !== "string") return false;
  const gesucht = normalisiert(zitat);
  if (gesucht === "") return false;
  return transcript.some(
    (zeile) => zeile.role !== AGENT_ROLE && normalisiert(zeile.text ?? "").includes(gesucht),
  );
}

export function gegenseitenUrteil(antwort: ModellAntwort, transcript: readonly Zeile[]): GegenseitenUrteil {
  return {
    confirmed: antwort.confirmed_by_counterparty === true && zitatBelegt(antwort.confirmation_quote, transcript),
    declined: antwort.declined === true,
  };
}
