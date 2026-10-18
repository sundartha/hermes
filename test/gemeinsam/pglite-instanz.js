function eineRundeDerEreignisschleife() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

export function abfragenZaehlendeHuelle(pg, laufend) {
  const mitzaehlen = (versprechen) => {
    laufend.add(versprechen);
    const austragen = () => laufend.delete(versprechen);
    versprechen.then(austragen, austragen);
    return versprechen;
  };
  const gezaehlt = {
    query: (...argumente) => mitzaehlen(pg.query(...argumente)),
    exec: (...argumente) => mitzaehlen(pg.exec(...argumente)),
    transaction: (...argumente) => mitzaehlen(pg.transaction(...argumente)),
    sql: (...argumente) => mitzaehlen(pg.sql(...argumente)),
  };
  return new Proxy(pg, {
    get(ziel, name) {
      if (Object.hasOwn(gezaehlt, name)) return gezaehlt[name];
      const wert = Reflect.get(ziel, name, ziel);
      return typeof wert === "function" ? wert.bind(ziel) : wert;
    },
  });
}

export async function abwartenBisNichtsMehrLaeuft(laufend, vorJederRunde) {
  do {
    await vorJederRunde?.();
    await Promise.allSettled([...laufend]);
    await eineRundeDerEreignisschleife();
  } while (laufend.size > 0);
}
