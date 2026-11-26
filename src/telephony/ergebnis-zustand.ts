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

function gegenseitenZeilen(call: AnrufSicht): number {
  return call.transcript.filter((zeile) => zeile.role !== AGENT_ROLE && (zeile.text ?? "").trim() !== "").length;
}

export function ergebnisZustand(call: AnrufSicht): ErgebnisZustand {
  if (failureReasonBase(call.failureReason) === RESULT_REASON.NO_ANSWER || call.answeredAt == null) {
    return nichtErledigt(RESULT_REASON.NO_ANSWER);
  }
  if (call.transcript.length > 0 && gegenseitenZeilen(call) === 0) return nichtErledigt(RESULT_REASON.MENU_ONLY);
  const gegenseite = call.result?.counterparty;
  if (gegenseite?.declined) return nichtErledigt(RESULT_REASON.DECLINED);
  if (gegenseite?.confirmed && call.objectiveAchieved === true) {
    return { result_state: RESULT_STATE.DONE_CONFIRMED, result_reason: null };
  }
  return { result_state: RESULT_STATE.UNCONFIRMED, result_reason: null };
}
