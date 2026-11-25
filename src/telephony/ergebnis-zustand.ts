import { failureReasonBase } from "./failure-reason.ts";

export const RESULT_STATE = Object.freeze({
  NOT_DONE: "not_done",
  UNCONFIRMED: "unconfirmed",
});

export const RESULT_REASON = Object.freeze({
  MENU_ONLY: "menu-only",
  NO_ANSWER: "no-answer",
});

export interface ErgebnisZustand {
  result_state: string;
  result_reason: string | null;
}

interface AnrufSicht {
  answeredAt?: string | null;
  failureReason?: string | null;
  transcript: readonly { role?: string; text?: string }[];
}

const AGENT_ROLE = "agent";

function nichtErledigt(grund: string): ErgebnisZustand {
  return { result_state: RESULT_STATE.NOT_DONE, result_reason: grund };
}

function gegenseitenZeilen(call: AnrufSicht): number {
  return call.transcript.filter((zeile) => zeile.role !== AGENT_ROLE && (zeile.text ?? "").trim() !== "").length;
}

export function ergebnisZustand(call: AnrufSicht): ErgebnisZustand {
  if (failureReasonBase(call.failureReason) === RESULT_REASON.NO_ANSWER || call.answeredAt == null) {
    return nichtErledigt(RESULT_REASON.NO_ANSWER);
  }
  if (call.transcript.length > 0 && gegenseitenZeilen(call) === 0) return nichtErledigt(RESULT_REASON.MENU_ONLY);
  return { result_state: RESULT_STATE.UNCONFIRMED, result_reason: null };
}
