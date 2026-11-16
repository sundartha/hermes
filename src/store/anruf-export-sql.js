const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, false)`;
const ANRUFE_SQL = `SELECT * FROM call WHERE tenant_id = $1 ORDER BY seq DESC`;
const SEGMENTE_SQL = `SELECT * FROM transcript_segment WHERE tenant_id = $1 ORDER BY id ASC`;
const PUNKTE_SQL = `SELECT * FROM action_item WHERE tenant_id = $1 ORDER BY seq DESC`;
const FEHLER = "[pg] anruf-export lesen fehlgeschlagen:";

export function macheAnrufExport({ runner, zeilenZuAnrufen }) {
  return {
    lies: (tenantId) =>
      runner
        .withClient(async (client) => {
          await client.query(KONTEXT_SQL, [tenantId]);
          const anrufe = (await client.query(ANRUFE_SQL, [tenantId])).rows;
          const segmente = (await client.query(SEGMENTE_SQL, [tenantId])).rows;
          const punkte = (await client.query(PUNKTE_SQL, [tenantId])).rows;
          return zeilenZuAnrufen(anrufe, segmente, punkte);
        })
        .catch((err) => {
          console.error(FEHLER, err.message);
          throw err;
        }),
  };
}
