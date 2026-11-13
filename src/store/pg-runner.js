import { hauptPoolOptionen, poolFehlerZeile, ueberwacheClients } from "../utils/pg-pool.js";

export async function createPgPoolRunner(connectionString) {
  const pg = (await import("pg")).default;
  const pool = new pg.Pool(hauptPoolOptionen(connectionString));
  pool.on("error", (err) => console.error(poolFehlerZeile("haupt", err)));
  ueberwacheClients(pool, "haupt");
  const runner = {
    async withClient(fn) {
      const client = await pool.connect();
      try {
        return await fn({
          query: (text, params) => client.query(text, params),
          exec: (sql) => client.query(sql),
        });
      } finally {
        client.release();
      }
    },
  };
  return {
    runner,
    poolZustand: () => ({ wartend: pool.waitingCount, offen: pool.totalCount }),
  };
}
