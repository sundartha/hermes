import { makeChainMutex } from "./chain-mutex.js";

export function makeSingleFlight(task: () => unknown): () => Promise<void> {
  const runExclusive = makeChainMutex();
  return function runSingleFlight() {
    return runExclusive(task);
  };
}

export function makeKeyedSingleFlight<A extends unknown[], T>(
  start: (...argumente: A) => Promise<T>,
  keyOf?: (...argumente: A) => unknown,
): (...argumente: A) => Promise<T>;
export function makeKeyedSingleFlight<T>(
  start: (...argumente: unknown[]) => Promise<T>,
  keyOf: (...argumente: unknown[]) => unknown = (erstesArgument) => erstesArgument,
): (...argumente: unknown[]) => Promise<T> {
  const imFlug = new Map<unknown, Promise<T>>();
  return function teileLaufendenVersuch(...argumente) {
    const schluessel = keyOf(...argumente);
    const laufend = imFlug.get(schluessel);
    if (laufend) return laufend;
    const versuch = start(...argumente).finally(() => imFlug.delete(schluessel));
    imFlug.set(schluessel, versuch);
    return versuch;
  };
}
