const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, false)`;
const ANRUFE_SQL = `SELECT * FROM call WHERE tenant_id = $1 ORDER BY seq DESC`;
const SEGMENTE_SQL = `SELECT * FROM transcript_segment WHERE tenant_id = $1 ORDER BY id ASC`;
const PUNKTE_SQL = `SELECT * FROM action_item WHERE tenant_id = $1 ORDER BY seq DESC`;
const NEUESTE_SQL = `SELECT * FROM call WHERE tenant_id = $1 ORDER BY seq DESC LIMIT $2`;
const NEUESTE_SEGMENTE_SQL = `SELECT * FROM transcript_segment WHERE tenant_id = $1 AND call_id = ANY($2) ORDER BY id ASC`;
const NEUESTE_PUNKTE_SQL = `SELECT * FROM action_item WHERE tenant_id = $1 AND call_id = ANY($2) ORDER BY seq DESC`;
const FEHLER = "[pg] anruf-export lesen fehlgeschlagen:";

export function macheAnrufExport({ runner, zeilenZuAnrufen }) {
  const imKontext = (tenantId, lesen) =>
    runner
      .withClient(async (client) => {
        await client.query(KONTEXT_SQL, [tenantId]);
        return lesen(client);
      })
      .catch((err) => {
        console.error(FEHLER, err.message);
        throw err;
      });
  return {
    lies: (tenantId) =>
      imKontext(tenantId, async (client) => {
        const anrufe = (await client.query(ANRUFE_SQL, [tenantId])).rows;
        const segmente = (await client.query(SEGMENTE_SQL, [tenantId])).rows;
        const punkte = (await client.query(PUNKTE_SQL, [tenantId])).rows;
        return zeilenZuAnrufen(anrufe, segmente, punkte);
      }),
    neueste: (tenantId, limit) =>
      imKontext(tenantId, async (client) => {
        const anrufe = (await client.query(NEUESTE_SQL, [tenantId, limit])).rows;
        const ids = anrufe.map((zeile) => zeile.id);
        const segmente = (await client.query(NEUESTE_SEGMENTE_SQL, [tenantId, ids])).rows;
        const punkte = (await client.query(NEUESTE_PUNKTE_SQL, [tenantId, ids])).rows;
        return zeilenZuAnrufen(anrufe, segmente, punkte);
      }),
  };
}
