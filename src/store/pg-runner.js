export async function createPgPoolRunner(connectionString) {
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString });
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
  return { runner, close: () => pool.end() };
}
