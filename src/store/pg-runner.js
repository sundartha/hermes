import { AsyncLocalStorage } from "node:async_hooks";
import { hauptPoolOptionen, poolFehlerZeile, ueberwacheClients } from "../utils/pg-pool.js";

const haltSpeicher = new AsyncLocalStorage();

const sichtAuf = (client) => ({
  query: (text, params) => client.query(text, params),
  exec: (sql) => client.query(sql),
});

function macheReihe() {
  let ende = Promise.resolve();
  return {
    einreihen(arbeit) {
      const lauf = ende.then(arbeit);
      ende = lauf.catch(() => {});
      return lauf;
    },
    abwarten: () => ende,
  };
}

function aufGehaltenerVerbindung({ halt, innen }, fn) {
  const sicht = sichtAuf(halt.client);
  if (innen) return fn(sicht);
  return halt.reihe.einreihen(() => haltSpeicher.run({ halt, innen: true }, () => fn(sicht)));
}

export async function createPgPoolRunner(connectionString) {
  const pg = (await import("pg")).default;
  const pool = new pg.Pool(hauptPoolOptionen(connectionString));
  pool.on("error", (err) => console.error(poolFehlerZeile("haupt", err)));
  ueberwacheClients(pool, "haupt");
  const runner = {
    async withClient(fn) {
      const kontext = haltSpeicher.getStore();
      if (kontext?.halt.aktiv) return aufGehaltenerVerbindung(kontext, fn);
      const client = await pool.connect();
      try {
        return await fn(sichtAuf(client));
      } finally {
        client.release();
      }
    },
    async halten(fn) {
      const client = await pool.connect();
      const halt = { client, aktiv: true, reihe: macheReihe() };
      let verworfen;
      try {
        return await haltSpeicher.run({ halt, innen: false }, () => fn(sichtAuf(client), (fehler) => {
          verworfen = fehler;
        }));
      } finally {
        halt.aktiv = false;
        await halt.reihe.abwarten();
        client.release(verworfen);
      }
    },
  };
  return {
    runner,
    poolZustand: () => ({ wartend: pool.waitingCount, offen: pool.totalCount }),
  };
}
