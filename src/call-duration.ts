import { MS_PER_SECOND } from "./utils/timer.js";
import { MAX_CALL_DURATION_CAP_S } from "./begriffe/anrufe.js";

interface AnrufDauer {
  maxDurationS?: number;
}

export function callMaxDurationMs(call: object, defaultMaxDurationS: number): number;
export function callMaxDurationMs(call: AnrufDauer, defaultMaxDurationS: number): number {
  const eigeneS = call.maxDurationS;
  if (!eigeneS) return defaultMaxDurationS * MS_PER_SECOND;
  return eigeneS * MS_PER_SECOND;
}

export const maxDurationSOf = (call: object): number => callMaxDurationMs(call, MAX_CALL_DURATION_CAP_S) / MS_PER_SECOND;

const SECONDS_PER_MINUTE = 60;

export const BRAKE_BUFFER_MINUTES = 1;

function affordableMinutes(remainingCents: number, tariffCentsPerMin: number) {
  if (!Number.isFinite(remainingCents)) return null;
  if (!Number.isFinite(tariffCentsPerMin) || tariffCentsPerMin <= 0) return null;
  return Math.max(0, Math.floor(remainingCents / tariffCentsPerMin));
}

export function emergencyBrakeSeconds({
  remainingCents,
  tariffCentsPerMin,
}: {
  remainingCents: number;
  tariffCentsPerMin: number;
}): number {
  const affordable = affordableMinutes(remainingCents, tariffCentsPerMin);
  if (affordable === null) return MAX_CALL_DURATION_CAP_S;
  return Math.min(
    (affordable + BRAKE_BUFFER_MINUTES) * SECONDS_PER_MINUTE,
    MAX_CALL_DURATION_CAP_S,
  );
}
