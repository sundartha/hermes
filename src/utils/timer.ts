export function defaultSetTimer(fn: () => void, ms: number): NodeJS.Timeout {
  const handle = setTimeout(fn, ms);
  handle.unref();
  return handle;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const MS_PER_SECOND = 1000;

export const MS_PER_MINUTE = 60 * MS_PER_SECOND;

const MINUTES_PER_HOUR = 60;

export const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;

const HOURS_PER_DAY = 24;

export const MS_PER_DAY = HOURS_PER_DAY * MS_PER_HOUR;
