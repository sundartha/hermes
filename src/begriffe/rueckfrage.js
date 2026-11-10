export const CONSULT_STATUS = Object.freeze({
  OPEN: "open",
  ANSWERED: "answered",
  EXPIRED: "expired",
  TIMED_OUT: "timed_out",
});

export const CONSULT_WAIT = Object.freeze({
  NONE: "none",
  HOLD: "hold",
  PENDING: "pending",
  TIMED_OUT: "timed_out",
  ANSWERED: "answered",
});

export const CONSULT_ANSWER = Object.freeze({
  ACCEPTED: "accepted",
  UNKNOWN_EVENT: "unknown_event",
  ALREADY_ANSWERED: "already_answered",
  CALL_ENDED: "call_ended",
  DEADLINE_PASSED: "deadline_passed",
});

export const CONSULT_TIMEOUT_REASON = Object.freeze({
  NOT_DELIVERED: "not_delivered",
  NOT_ACKED: "not_acked",
  TIMEOUT: "timeout",
});

export const CONSULT_ANSWER_MODE = Object.freeze({ WORKING: "working", FINAL: "final" });
