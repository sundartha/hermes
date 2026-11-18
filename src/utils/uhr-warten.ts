export function defaultSetTimer(fn: () => void, ms: number): NodeJS.Timeout {
  const handle = setTimeout(fn, ms);
  handle.unref();
  return handle;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
