export const PAGE_COMMIT_RATIO = 0.1;
export const PAGE_FLICK_SPEED = 0.2;
export const PAGE_FLICK_MIN_PX = 16;
export const PAGE_MS_MIN = 280;
export const PAGE_MS_MAX = 620;
export const WHEEL_STEP_PX = 40;
export const WHEEL_QUIET_MS = 180;
const WHEEL_LINE_PX = 16;
const WHEEL_MODE_LINES = 1;
const WHEEL_MODE_PAGES = 2;

export function pageStep({ moved, velocity, height }) {
  if (Math.abs(moved) < PAGE_FLICK_MIN_PX || !(height > 0)) return 0;
  const direction = Math.sign(moved);
  if (Math.abs(velocity) >= PAGE_FLICK_SPEED)
    return Math.sign(velocity) === direction ? direction : 0;
  return Math.abs(moved) >= height * PAGE_COMMIT_RATIO ? direction : 0;
}

export function pageTarget(base, step, count) {
  return Math.min(count - 1, Math.max(0, base + Math.sign(step)));
}

export function pageDuration(distance, height) {
  const share = height > 0 ? Math.min(1, Math.abs(distance) / height) : 1;
  return Math.round(PAGE_MS_MIN + (PAGE_MS_MAX - PAGE_MS_MIN) * share);
}

export function wheelPixels(deltaY, deltaMode, height) {
  if (deltaMode === WHEEL_MODE_LINES) return deltaY * WHEEL_LINE_PX;
  if (deltaMode === WHEEL_MODE_PAGES) return deltaY * height;
  return deltaY;
}
