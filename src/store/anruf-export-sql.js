const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, false)`;
const MANDANTEN_SQL = `SELECT id FROM tenant ORDER BY id`;
const ANRUFE_SQL = `SELECT * FROM call WHERE tenant_id = $1 ORDER BY seq DESC`;
const SEGMENTE_SQL = `SELECT * FROM transcript_segment WHERE tenant_id = $1 ORDER BY id ASC`;
const PUNKTE_SQL = `SELECT * FROM action_item WHERE tenant_id = $1 ORDER BY seq DESC`;
const NEUESTE_SQL = `SELECT * FROM call WHERE tenant_id = $1 ORDER BY seq DESC LIMIT $2`;
const NEUESTE_SEGMENTE_SQL = `SELECT * FROM transcript_segment WHERE tenant_id = $1 AND call_id = ANY($2) ORDER BY id ASC`;
const NEUESTE_PUNKTE_SQL = `SELECT * FROM action_item WHERE tenant_id = $1 AND call_id = ANY($2) ORDER BY seq DESC`;
const SEIT_SQL = `SELECT count(*)::int AS anzahl FROM call WHERE tenant_id = $1 AND started_at >= $2 COLLATE "C"`;
const FEHLER = "[pg] anruf-export lesen fehlgeschlagen:";

export function macheAnrufExport({ runner, zeilenZuAnrufen }) {
  const lesend = (lesen) =>
    runner.withClient(lesen).catch((err) => {
      console.error(FEHLER, err.message);
      throw err;
    });
  const imKontext = (tenantId, lesen) =>
    lesend(async (client) => {
      await client.query(KONTEXT_SQL, [tenantId]);
      return lesen(client);
    });
  return {
    lies: (tenantId) =>
      imKontext(tenantId, async (client) => {
        const anrufe = (await client.query(ANRUFE_SQL, [tenantId])).rows;
        const segmente = (await client.query(SEGMENTE_SQL, [tenantId])).rows;
        const punkte = (await client.query(PUNKTE_SQL, [tenantId])).rows;
        return zeilenZuAnrufen(anrufe, segmente, punkte);
      }),
    berichte: () =>
      lesend(async (client) => {
        const anrufe = [];
        for (const { id } of (await client.query(MANDANTEN_SQL)).rows) {
          await client.query(KONTEXT_SQL, [id]);
          anrufe.push(...zeilenZuAnrufen((await client.query(ANRUFE_SQL, [id])).rows, [], []));
        }
        return anrufe;
      }),
    zaehleSeit: (tenantId, seitIso) =>
      imKontext(tenantId, async (client) => {
        const { rows } = await client.query(SEIT_SQL, [tenantId, seitIso]);
        return rows[0].anzahl;
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
