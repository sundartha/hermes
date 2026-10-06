export function makeChainMutex() {
  let chain = Promise.resolve();
  return function runExclusive(fn) {
    const run = () => fn();
    chain = chain.then(run, run);
    return chain;
  };
}

export function makeKeyedChainMutex() {
  const chainsByKey = new Map();
  return function runExclusiveForKey(key, fn) {
    let entry = chainsByKey.get(key);
    if (!entry) {
      entry = { runExclusive: makeChainMutex(), inFlight: 0 };
      chainsByKey.set(key, entry);
    }
    entry.inFlight += 1;
    const release = () => {
      entry.inFlight -= 1;
      if (entry.inFlight === 0) chainsByKey.delete(key);
    };
    return entry.runExclusive(fn).then(
      (value) => {
        release();
        return value;
      },
      (err) => {
        release();
        throw err;
      },
    );
  };
}
