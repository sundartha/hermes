import { makeChainMutex } from "./chain-mutex.js";

export function makeSingleFlight(task) {
  const runExclusive = makeChainMutex();
  return function runSingleFlight() {
    return runExclusive(task);
  };
}
