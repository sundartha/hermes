const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, false)`;
const ZAEHLEN_SQL = `SELECT count(*)::int AS anzahl FROM call
  WHERE tenant_id = $1 AND direction = 'outbound' AND started_at >= $2 COLLATE "C"
    AND ($3::text IS NULL OR requested_by = $3) AND ($4::text IS NULL OR to_e164 = $4)`;

export function macheAnrufeSql({ runner }) {
  return {
    zaehleAusgehend: async (sinceIso, { tenantId, requestedBy = null, to = null }) => {
      if (!tenantId) throw new Error("countOutboundCallsSince: tenantId ist Pflicht");
      return runner.withClient(async (client) => {
        await client.query(KONTEXT_SQL, [tenantId]);
        const { rows } = await client.query(ZAEHLEN_SQL, [tenantId, sinceIso, requestedBy, to]);
        return rows[0].anzahl;
      });
    },
  };
}
