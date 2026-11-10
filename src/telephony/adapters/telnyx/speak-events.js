import { z } from "zod";

export const SPEAK_OUTCOME = Object.freeze({
  NONE: "none",
  OK: "ok",
  FAILED: "failed",
});

const KNOWN_REASONS = Object.freeze(["completed", "failed"]);
const REASON_UNKNOWN = "unknown";

const JSON_OBJEKT = z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]);

function eventEnvelope(body) {
  const huelle = JSON_OBJEKT.safeParse(body);
  if (!huelle.success) return null;
  const daten = JSON_OBJEKT.safeParse(huelle.data.data);
  const ev = daten.success ? daten.data : huelle.data;
  return ev.event_type ? ev : null;
}

function safeReason(status) {
  return KNOWN_REASONS.includes(status) ? status : REASON_UNKNOWN;
}

export function parseSpeakEvent(body) {
  const ev = eventEnvelope(body);
  if (!ev) return { outcome: SPEAK_OUTCOME.NONE, reason: null };
  const nutzlast = JSON_OBJEKT.safeParse(ev.payload);
  const status = nutzlast.success ? nutzlast.data.status : undefined;
  if (ev.event_type === "call.speak.failed" || status === "failed")
    return { outcome: SPEAK_OUTCOME.FAILED, reason: safeReason(status || "failed") };
  if (ev.event_type === "call.speak.ended" && status === "completed")
    return { outcome: SPEAK_OUTCOME.OK, reason: safeReason(status) };
  return { outcome: SPEAK_OUTCOME.NONE, reason: null };
}
