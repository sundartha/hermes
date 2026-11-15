import { z } from "zod";

export const SPEAK_OUTCOME = Object.freeze({
  NONE: "none",
  OK: "ok",
  FAILED: "failed",
});

const KNOWN_REASONS: readonly unknown[] = Object.freeze(["completed", "failed"]);
const REASON_UNKNOWN = "unknown";

const JSON_OBJEKT = z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]);

function feld(objekt: unknown[] | Record<string, unknown>, name: string): unknown {
  return Reflect.get(objekt, name);
}

function eventEnvelope(body: unknown) {
  const huelle = JSON_OBJEKT.safeParse(body);
  if (!huelle.success) return null;
  const daten = JSON_OBJEKT.safeParse(feld(huelle.data, "data"));
  const ev = daten.success ? daten.data : huelle.data;
  return feld(ev, "event_type") ? ev : null;
}

function safeReason(status: unknown): unknown {
  return KNOWN_REASONS.includes(status) ? status : REASON_UNKNOWN;
}

export function parseSpeakEvent(body: unknown): { outcome: string; reason: unknown } {
  const ev = eventEnvelope(body);
  if (!ev) return { outcome: SPEAK_OUTCOME.NONE, reason: null };
  const nutzlast = JSON_OBJEKT.safeParse(feld(ev, "payload"));
  const status = nutzlast.success ? feld(nutzlast.data, "status") : undefined;
  if (feld(ev, "event_type") === "call.speak.failed" || status === "failed")
    return { outcome: SPEAK_OUTCOME.FAILED, reason: status ? safeReason(status) : "failed" };
  if (feld(ev, "event_type") === "call.speak.ended" && status === "completed")
    return { outcome: SPEAK_OUTCOME.OK, reason: safeReason(status) };
  return { outcome: SPEAK_OUTCOME.NONE, reason: null };
}
