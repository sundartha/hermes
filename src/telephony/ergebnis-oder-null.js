import { once } from "node:events";

export function ergebnisOderNull(versprechen, ms) {
  const frist = once(AbortSignal.timeout(Math.max(0, ms)), "abort").then(() => null);
  return Promise.race([versprechen, frist]);
}
