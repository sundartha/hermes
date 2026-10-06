import { MS_PER_SECOND } from "./utils/timer.js";
import { MAX_CALL_DURATION_CAP_S } from "./store/defaults.js";

export function callMaxDurationMs(call, defaultMaxDurationS) {
  return (call.maxDurationS || defaultMaxDurationS) * MS_PER_SECOND;
}

const SECONDS_PER_MINUTE = 60;

export const BRAKE_BUFFER_MINUTES = 1;

function affordableMinutes(remainingCents, tariffCentsPerMin) {
  if (!Number.isFinite(remainingCents)) return null;
  if (!Number.isFinite(tariffCentsPerMin) || tariffCentsPerMin <= 0) return null;
  return Math.max(0, Math.floor(remainingCents / tariffCentsPerMin));
}

export function emergencyBrakeSeconds({ remainingCents, tariffCentsPerMin }) {
  const affordable = affordableMinutes(remainingCents, tariffCentsPerMin);
  if (affordable === null) return MAX_CALL_DURATION_CAP_S;
  return Math.min(
    (affordable + BRAKE_BUFFER_MINUTES) * SECONDS_PER_MINUTE,
    MAX_CALL_DURATION_CAP_S,
  );
}
