import { makeChainMutex } from "./chain-mutex.js";

export function makeSingleFlight(task) {
  const runExclusive = makeChainMutex();
  return function runSingleFlight() {
    return runExclusive(task);
  };
}

export function makeKeyedSingleFlight(start, keyOf = (erstesArgument) => erstesArgument) {
  const imFlug = new Map();
  return function teileLaufendenVersuch(...argumente) {
    const schluessel = keyOf(...argumente);
    const laufend = imFlug.get(schluessel);
    if (laufend) return laufend;
    const versuch = start(...argumente).finally(() => imFlug.delete(schluessel));
    imFlug.set(schluessel, versuch);
    return versuch;
  };
}
