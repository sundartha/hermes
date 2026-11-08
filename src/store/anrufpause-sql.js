const LESEN_SQL = `SELECT an FROM platform_anrufpause WHERE id = 1`;
const SCHREIBEN_SQL = `INSERT INTO platform_anrufpause (id, an) VALUES (1, $1)
  ON CONFLICT (id) DO UPDATE SET an = EXCLUDED.an`;

export function macheAnrufpauseSql({ einreihen, runner }) {
  return {
    lesen: () =>
      runner.withClient(async (client) => {
        const { rows } = await client.query(LESEN_SQL);
        return rows[0]?.an === true;
      }),
    schreiben: (an) => einreihen((client) => client.query(SCHREIBEN_SQL, [an])),
  };
}
