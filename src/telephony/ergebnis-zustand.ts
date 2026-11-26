import type { GegenseitenUrteil } from "../call-result.ts";
import { failureReasonBase } from "./failure-reason.ts";

export const RESULT_STATE = Object.freeze({
  DONE_CONFIRMED: "done_confirmed",
  NOT_DONE: "not_done",
  UNCONFIRMED: "unconfirmed",
});

export const RESULT_REASON = Object.freeze({
  MENU_ONLY: "menu-only",
  NO_ANSWER: "no-answer",
  DECLINED: "declined",
});

export interface ErgebnisZustand {
  result_state: string;
  result_reason: string | null;
}

interface AnrufSicht {
  answeredAt?: string | null;
  failureReason?: string | null;
  objectiveAchieved?: boolean | string | null;
  result?: { counterparty?: { confirmed: boolean; declined: boolean } } | null;
  transcript: readonly { role?: string; text?: string }[];
}

const AGENT_ROLE = "agent";

function nichtErledigt(grund: string): ErgebnisZustand {
  return { result_state: RESULT_STATE.NOT_DONE, result_reason: grund };
}

function gegenseitenTexte(transcript: AnrufSicht["transcript"]): string[] {
  const texte: string[] = [];
  for (const zeile of transcript) {
    if (zeile.role !== AGENT_ROLE && typeof zeile.text === "string" && zeile.text.trim() !== "") texte.push(zeile.text);
  }
  return texte;
}

function urteilZustand(call: AnrufSicht): ErgebnisZustand {
  const gegenseite = call.result?.counterparty;
  if (gegenseite?.declined) return nichtErledigt(RESULT_REASON.DECLINED);
  if (gegenseite?.confirmed && call.objectiveAchieved === true) {
    return { result_state: RESULT_STATE.DONE_CONFIRMED, result_reason: null };
  }
  return { result_state: RESULT_STATE.UNCONFIRMED, result_reason: null };
}

export function ergebnisZustand(call: AnrufSicht): ErgebnisZustand {
  if (failureReasonBase(call.failureReason) === RESULT_REASON.NO_ANSWER || call.answeredAt == null) {
    return nichtErledigt(RESULT_REASON.NO_ANSWER);
  }
  if (call.transcript.length > 0 && gegenseitenTexte(call.transcript).length === 0) return nichtErledigt(RESULT_REASON.MENU_ONLY);
  return urteilZustand(call);
}

export const BESTAETIGUNGS_KLAUSEL =
  ' Ergaenze ausserdem "confirmed_by_counterparty" (true nur, wenn die Gegenseite das Ergebnis AUSDRUECKLICH bestaetigt hat, z.B. "ja, Dienstag um 10 Uhr passt"; sonst false), "confirmation_quote" (das woertliche Zitat der Gegenseite aus dem Transkript, das die Bestaetigung belegt, sonst null) und "declined" (true nur, wenn die Gegenseite den Auftrag ausdruecklich abgelehnt hat, sonst false). Eine Zusage des Assistenten oder ein Schweigen der Gegenseite ist keine Bestaetigung.';

interface ModellAntwort {
  confirmed_by_counterparty?: unknown;
  confirmation_quote?: unknown;
  declined?: unknown;
}

function normalisiert(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function zitatBelegt(zitat: unknown, transcript: AnrufSicht["transcript"]): boolean {
  if (typeof zitat !== "string") return false;
  const gesucht = normalisiert(zitat);
  if (gesucht === "") return false;
  return gegenseitenTexte(transcript).some((text) => normalisiert(text).includes(gesucht));
}

export function gegenseitenUrteil(antwort: ModellAntwort, transcript: AnrufSicht["transcript"]): GegenseitenUrteil {
  return {
    confirmed: antwort.confirmed_by_counterparty === true && zitatBelegt(antwort.confirmation_quote, transcript),
    declined: antwort.declined === true,
  };
}
