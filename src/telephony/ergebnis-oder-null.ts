import { once } from "node:events";

export function ergebnisOderNull<T>(
  versprechen: Promise<T>,
  ms: number,
): Promise<Awaited<T> | null> {
  const frist = once(AbortSignal.timeout(Math.max(0, ms)), "abort").then(() => null);
  return Promise.race([versprechen, frist]);
}
