import { KOSTENPROFIL, kostenprofilFuerAnruf } from "../billing/kostenarten.ts";
import { NICHT_ERREICHT_FRIST_MS } from "../begriffe/anrufe.js";

export { NICHT_ERREICHT_FRIST_MS };
export const NICHT_ANGENOMMEN_GRUND = "no-answer";

const OHNE_ABFRAGE_FRIST: ReadonlySet<unknown> = new Set([
  KOSTENPROFIL.TELNYX_INBOUND_BUDGET,
  KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
  KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
]);

interface Anruf {
  costProfile?: string | null;
  sipCallId?: unknown;
  direction?: unknown;
  startedAt?: unknown;
}

interface Gespraech {
  transcript?: ({ message?: unknown } | null)[] | null;
  metadata?: { call_duration_secs?: unknown } | null;
}

function hatGesprochen(gespraech: Gespraech): boolean {
  return (gespraech.transcript ?? []).some((zeile) => Boolean(zeile?.message));
}

function hatAnbieterDauer(gespraech: Gespraech): boolean {
  const dauer = gespraech.metadata?.call_duration_secs;
  return typeof dauer === "number" && dauer > 0;
}

export function nichtErreichtNachFrist({
  call,
  conversation,
  nowMs,
}: {
  call: Anruf;
  conversation: Gespraech;
  nowMs: number;
}): boolean {
  if (OHNE_ABFRAGE_FRIST.has(kostenprofilFuerAnruf(call))) return false;
  const startMs = Date.parse(String(call.startedAt));
  if (!Number.isFinite(startMs) || nowMs - startMs < NICHT_ERREICHT_FRIST_MS) return false;
  return !hatGesprochen(conversation) && !hatAnbieterDauer(conversation);
}
