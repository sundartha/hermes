import { gueltigerZeitpunkt, type GegenseitenUrteil, type TerminBeleg } from "../call-result.ts";
import { failureReasonBase } from "./failure-reason.ts";

export const RESULT_STATE = Object.freeze({
  DONE_CONFIRMED: "done_confirmed",
  NOT_DONE: "not_done",
  UNCONFIRMED: "unconfirmed",
});

export const RESULT_REASON = Object.freeze({
  MENU_ONLY: "menu-only",
  MAILBOX: "mailbox",
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
  result?: { counterparty?: GegenseitenUrteil } | null;
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
  if (call.result?.counterparty?.mailbox) return nichtErledigt(RESULT_REASON.MAILBOX);
  if (call.transcript.length > 0 && gegenseitenTexte(call.transcript).length === 0) return nichtErledigt(RESULT_REASON.MENU_ONLY);
  return urteilZustand(call);
}

export function terminLage(call: AnrufSicht): (TerminBeleg & { bestaetigt: boolean }) | null {
  const termin = call.result?.counterparty?.appointment;
  if (!termin) return null;
  return { ...termin, bestaetigt: ergebnisZustand(call).result_state === RESULT_STATE.DONE_CONFIRMED };
}

export const BESTAETIGUNGS_KLAUSEL =
  ' Ergaenze ausserdem "confirmed_by_counterparty" (true nur, wenn die Gegenseite das Ergebnis AUSDRUECKLICH bestaetigt hat, z.B. "ja, Dienstag um 10 Uhr passt"; sonst false), "confirmation_quote" (das woertliche Zitat der Gegenseite aus dem Transkript, das die Bestaetigung belegt, sonst null), "declined" (true nur, wenn die Gegenseite den Auftrag ausdruecklich abgelehnt hat, sonst false) und "mailbox_only" (true nur, wenn ausser einem Anrufbeantworter oder einer Mailbox niemand erreicht wurde; sonst false). Eine Zusage des Assistenten oder ein Schweigen der Gegenseite ist keine Bestaetigung. Ergaenze ausserdem "appointment_task" (true nur, wenn der Auftrag einen Termin betrifft, also vereinbaren, verschieben oder absagen; sonst false), "appointment_at" (Datum und Uhrzeit des vereinbarten, verschobenen oder abgesagten Termins als "YYYY-MM-DDTHH:MM" oder "YYYY-MM-DD", nur wenn im Transkript genannt, sonst null) und "confirmed_by" (Name der bestaetigenden Person, woertlich wie von der Gegenseite genannt, sonst null).';

interface ModellAntwort {
  confirmed_by_counterparty?: unknown;
  confirmation_quote?: unknown;
  declined?: unknown;
  mailbox_only?: unknown;
  appointment_task?: unknown;
  appointment_at?: unknown;
  confirmed_by?: unknown;
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

function terminBeleg(antwort: ModellAntwort, transcript: AnrufSicht["transcript"]): TerminBeleg {
  const name = antwort.confirmed_by;
  return {
    at: gueltigerZeitpunkt(antwort.appointment_at),
    confirmedBy: zitatBelegt(name, transcript) ? String(name).trim() : null,
  };
}

export function gegenseitenUrteil(antwort: ModellAntwort, transcript: AnrufSicht["transcript"]): GegenseitenUrteil {
  return {
    confirmed: antwort.confirmed_by_counterparty === true && zitatBelegt(antwort.confirmation_quote, transcript),
    declined: antwort.declined === true,
    ...(antwort.mailbox_only === true && { mailbox: true }),
    ...(antwort.appointment_task === true && { appointment: terminBeleg(antwort, transcript) }),
  };
}
