// Pure utility: turn a millisecond duration into a compact, human-readable
// string such as "1h 1m 1s". No dependencies, no side effects, no I/O.

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
// Derived, never hard-coded as 3600.
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;

// Exactly one valid input type: a finite number of milliseconds. Everything
// else (null, undefined, strings, objects, arrays, booleans, NaN, Infinity)
// is rejected with a single error category so callers can catch TypeError once.
export function formatDuration(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    throw new TypeError("formatDuration expects a finite number of milliseconds");
  }

  // Clamp negatives to zero, then truncate any sub-second remainder.
  const effectiveMs = ms > 0 ? ms : 0;
  const totalSeconds = Math.floor(effectiveMs / MS_PER_SECOND);

  // Any duration below one second (including 0 and clamped negatives) is "0s".
  if (totalSeconds === 0) {
    return "0s";
  }

  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;

  // Emit only the units that are actually present (no "0h"/"0m" filler).
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);

  return parts.join(" ");
}
