export const SPEAK_OUTCOME = Object.freeze({
  NONE: "none",
  OK: "ok",
  FAILED: "failed",
});

const KNOWN_REASONS = Object.freeze(["completed", "failed"]);
const REASON_UNKNOWN = "unknown";

function eventEnvelope(body) {
  if (!body || typeof body !== "object") return null;
  const ev = body.data && typeof body.data === "object" ? body.data : body;
  return ev.event_type ? ev : null;
}

function safeReason(status) {
  return KNOWN_REASONS.includes(status) ? status : REASON_UNKNOWN;
}

export function parseSpeakEvent(body) {
  const ev = eventEnvelope(body);
  if (!ev) return { outcome: SPEAK_OUTCOME.NONE, reason: null };
  const status = ev.payload && typeof ev.payload === "object" ? ev.payload.status : undefined;
  if (ev.event_type === "call.speak.failed" || status === "failed")
    return { outcome: SPEAK_OUTCOME.FAILED, reason: safeReason(status || "failed") };
  if (ev.event_type === "call.speak.ended" && status === "completed")
    return { outcome: SPEAK_OUTCOME.OK, reason: safeReason(status) };
  return { outcome: SPEAK_OUTCOME.NONE, reason: null };
}
