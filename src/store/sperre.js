import { AsyncLocalStorage } from "node:async_hooks";
import { makeChainMutex } from "../chain-mutex.js";

const REENTRANCY_MARKER = Symbol("store-lock-active");

export function macheSpeicherSperre() {
  const runStoreExclusive = makeChainMutex();
  const storeLockContext = new AsyncLocalStorage();
  return function withStoreLock(fn) {
    if (storeLockContext.getStore()) {
      throw new Error(
        "withStoreLock reentrant: ein withStoreLock-Body darf NIE erneut withStoreLock aufrufen " +
          "(Deadlock-Schutz). Verschachtelten Store-Lock aufloesen; kritischen Abschnitt kurz halten.",
      );
    }
    return runStoreExclusive(() => storeLockContext.run(REENTRANCY_MARKER, fn));
  };
}
