export const ANSWERED_BY = Object.freeze({ MACHINE: "machine", HUMAN: "human", UNKNOWN: "unknown" });

type AnsweredBy = (typeof ANSWERED_BY)[keyof typeof ANSWERED_BY];

const MACHINE_TOKENS = ["machine_start", "machine_end_beep", "machine_end_silence", "machine_end_other", "fax"];

export function classifyAnsweredBy(raw: unknown): AnsweredBy {
  if (typeof raw !== "string") return ANSWERED_BY.UNKNOWN;
  if (MACHINE_TOKENS.includes(raw)) return ANSWERED_BY.MACHINE;
  if (raw === "human") return ANSWERED_BY.HUMAN;
  return ANSWERED_BY.UNKNOWN;
}

export function parseAnsweredBy(body: { AnsweredBy?: unknown }): AnsweredBy {
  return classifyAnsweredBy(body.AnsweredBy);
}
