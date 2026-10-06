export function defaultSetTimer(fn, ms) {
  const handle = setTimeout(fn, ms);
  if (handle && typeof handle.unref === "function") handle.unref();
  return handle;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const MS_PER_SECOND = 1000;

export const MS_PER_MINUTE = 60 * MS_PER_SECOND;

const MINUTES_PER_HOUR = 60;

export const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;
