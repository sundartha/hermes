const COMPLETED_STATUS = "completed";
const SELF_DESCRIBING_FAILURES = ["no-answer", "busy", "canceled"];
const GENERIC_FAILURE_STATUS = "failed";
const DETAIL_SEPARATOR = ":";

export function callFailureReason({ status, diagnostics } = {}) {
  if (!status || status === COMPLETED_STATUS) return null;
  if (SELF_DESCRIBING_FAILURES.includes(status)) return status;
  if (status === GENERIC_FAILURE_STATUS) return genericFailureReason(diagnostics);
  return status;
}

function genericFailureReason(diagnostics) {
  const rawCause = diagnostics?.sipHangupCause;
  const sip = statusNumber(rawCause, SIP_STATUS_MAX);
  const capacity = hasChannelLimit(diagnostics?.hangupCause);
  if (sip !== null) return reasonOf(sipBase(sip, capacity), detailOf(SOURCE_INVITE, sip));
  if (capacity) return reasonOf(AT_CAPACITY, SOURCE_INVITE);
  return rawCause ? `${GENERIC_FAILURE_STATUS}${DETAIL_SEPARATOR}${rawCause}` : GENERIC_FAILURE_STATUS;
}

export function failureReasonBase(reason) {
  return reason ? String(reason).split(DETAIL_SEPARATOR)[0] : null;
}

export function meldetAlsNichtGestartet(reason) {
  const base = failureReasonBase(reason);
  return base === NOT_PLACED || base === AT_CAPACITY;
}

export function reasonWithoutCarrier(reason) {
  return reason ? String(reason).replace(CARRIER_CODE_IN_REASON_SUFFIX, "") : null;
}

export const NOT_PLACED = "not-placed";
export const UNREACHABLE = "unreachable";
export const RESULT_UNKNOWN = "result-unknown";
export const AT_CAPACITY = "at-capacity";

export const FAILURE_REASON_BASE_TOKENS = Object.freeze([
  ...SELF_DESCRIBING_FAILURES,
  GENERIC_FAILURE_STATUS,
  NOT_PLACED,
  UNREACHABLE,
  RESULT_UNKNOWN,
  AT_CAPACITY,
]);

const SOURCE_START = "start";
const SOURCE_INVITE = "invite";
const SOURCE_PROVIDER = "provider";
const SOURCE_POLL = "poll";
const POLL_TIMEOUT_DETAIL = "timeout";

const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;
const HTTP_STATUS_MAX = 599;

const SIP_UNAUTHORIZED = 401;
const SIP_FORBIDDEN = 403;
const SIP_PROXY_AUTH_REQUIRED = 407;
const SIP_NOT_FOUND = 404;
const SIP_TEMPORARILY_UNAVAILABLE = 480;
const SIP_BUSY_HERE = 486;
const SIP_DECLINE = 603;
const SIP_SERVER_ERROR_MIN = 500;
const SIP_GLOBAL_FAILURE_MIN = 600;
const SIP_STATUS_MAX = 699;

const NOT_PLACED_SIP_STATUS = new Set([SIP_UNAUTHORIZED, SIP_FORBIDDEN, SIP_PROXY_AUTH_REQUIRED]);
const UNREACHABLE_SIP_STATUS = new Set([
  SIP_NOT_FOUND,
  SIP_TEMPORARILY_UNAVAILABLE,
  SIP_BUSY_HERE,
  SIP_DECLINE,
]);

const SIP_STATUS_IN_REASON = /sip status:\s*(\d{3})/i;
const CARRIER_CODE_IN_REASON = /\bD\d{2}\b/;
const CARRIER_CODE_IN_REASON_SUFFIX = /-D\d{2}$/;
const CHANNEL_LIMIT_MARK = /channel[ _-]limit/i;

const hasChannelLimit = (text) => typeof text === "string" && CHANNEL_LIMIT_MARK.test(text);

const detailOf = (source, code, carrier) => [source, code, carrier].filter(Boolean).join("-");
const reasonOf = (base, detail) => `${base}${DETAIL_SEPARATOR}${detail}`;

function statusNumber(value, max) {
  const zahl = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(zahl) && zahl >= HTTP_CLIENT_ERROR_MIN && zahl <= max ? zahl : null;
}

const START_NO_STATUS_DETAIL = "no-status";
const START_REFUSED_DETAIL = "refused";

const NOT_SENT_CAUSE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND"]);
const NOT_SENT_CAUSE_MESSAGE = "bad port";

export function requestNotSent(error) {
  const cause = error?.cause;
  return NOT_SENT_CAUSE_CODES.has(cause?.code) || cause?.message === NOT_SENT_CAUSE_MESSAGE;
}

export function startRejectionReason(providerStatus, notSent = false) {
  const code = statusNumber(providerStatus, HTTP_STATUS_MAX);
  if (code === null && notSent) return reasonOf(NOT_PLACED, detailOf(SOURCE_START, START_REFUSED_DETAIL));
  if (code === null) return reasonOf(RESULT_UNKNOWN, detailOf(SOURCE_START, START_NO_STATUS_DETAIL));
  return reasonOf(startBase(code), detailOf(SOURCE_START, code));
}

function startBase(code) {
  if (code === HTTP_TOO_MANY_REQUESTS) return AT_CAPACITY;
  return code >= HTTP_SERVER_ERROR_MIN ? RESULT_UNKNOWN : NOT_PLACED;
}

export function providerErrorReason(error) {
  if (!error || typeof error !== "object") return null;
  const reason = typeof error.reason === "string" ? error.reason : "";
  const sip = statusNumber(SIP_STATUS_IN_REASON.exec(reason)?.[1], SIP_STATUS_MAX);
  const carrier = CARRIER_CODE_IN_REASON.exec(reason)?.[0] ?? null;
  if (sip === null)
    return reasonOf(RESULT_UNKNOWN, detailOf(SOURCE_PROVIDER, statusNumber(error.code, HTTP_STATUS_MAX)));
  return reasonOf(sipBase(sip, hasChannelLimit(reason)), detailOf(SOURCE_INVITE, sip, carrier));
}

function sipBase(sip, capacity) {
  const base = sipFaultBase(sip);
  return capacity && base === NOT_PLACED ? AT_CAPACITY : base;
}

function sipFaultBase(sip) {
  if (UNREACHABLE_SIP_STATUS.has(sip)) return UNREACHABLE;
  if (NOT_PLACED_SIP_STATUS.has(sip)) return NOT_PLACED;
  if (sip >= SIP_SERVER_ERROR_MIN && sip < SIP_GLOBAL_FAILURE_MIN) return NOT_PLACED;
  return RESULT_UNKNOWN;
}

export const POLL_TIMEOUT_REASON = reasonOf(RESULT_UNKNOWN, detailOf(SOURCE_POLL, POLL_TIMEOUT_DETAIL));

export function pollProviderErrorReason(providerStatus) {
  return reasonOf(RESULT_UNKNOWN, detailOf(SOURCE_POLL, SOURCE_PROVIDER, statusNumber(providerStatus, HTTP_STATUS_MAX)));
}
