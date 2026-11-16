import { KOSTENPROFIL } from "../billing/kostenarten.js";
import { MS_PER_SECOND } from "../utils/timer.js";

const NICHT_ERREICHT_FRIST_S = 75;

export const NICHT_ERREICHT_FRIST_MS = NICHT_ERREICHT_FRIST_S * MS_PER_SECOND;
export const NICHT_ANGENOMMEN_GRUND = "no-answer";

interface Anruf {
  costProfile?: unknown;
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
  if (call.costProfile !== KOSTENPROFIL.EL_CONVAI_SIP) return false;
  const startMs = Date.parse(String(call.startedAt));
  if (!Number.isFinite(startMs) || nowMs - startMs < NICHT_ERREICHT_FRIST_MS) return false;
  return !hatGesprochen(conversation) && !hatAnbieterDauer(conversation);
}
