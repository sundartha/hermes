const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, false)`;
const MANDANTEN_SQL = `SELECT id FROM tenant ORDER BY id`;
const BELEGT_SQL = `SELECT 1 FROM call WHERE tenant_id = $1 AND status = 'active'
  AND (from_e164 = $2 OR to_e164 = $2) LIMIT 1`;
const FEHLER = "[pg] anruf-nummern lesen fehlgeschlagen:";

export function macheAnrufNummernSql({ runner }) {
  return {
    aktivBelegt: (e164) =>
      runner
        .withClient(async (client) => {
          for (const { id } of (await client.query(MANDANTEN_SQL)).rows) {
            await client.query(KONTEXT_SQL, [id]);
            const { rows } = await client.query(BELEGT_SQL, [id, e164]);
            if (rows.length > 0) return true;
          }
          return false;
        })
        .catch((err) => {
          console.error(FEHLER, err.message);
          throw err;
        }),
  };
}
