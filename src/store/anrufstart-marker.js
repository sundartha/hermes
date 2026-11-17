const SETZEN_SQL = `INSERT INTO anrufstart_marker (call_id, tenant_id, versucht_at) VALUES ($1, $2, $3)
  ON CONFLICT (call_id) DO NOTHING`;
const LESEN_SQL = `SELECT versucht_at FROM anrufstart_marker WHERE call_id = $1`;

export function makePostgresAnrufstartMarker(runner) {
  return {
    async setze({ callId, tenantId, jetztIso }) {
      const { rowCount } = await runner.withClient((client) => client.query(SETZEN_SQL, [callId, tenantId, jetztIso]));
      return rowCount === 1;
    },
    async lies(callId) {
      const { rows } = await runner.withClient((client) => client.query(LESEN_SQL, [callId]));
      return rows[0] ? new Date(rows[0].versucht_at).toISOString() : null;
    },
  };
}

export function makeAnrufstartMarker() {
  const zeitpunkte = new Map();
  return {
    async setze({ callId, jetztIso }) {
      if (zeitpunkte.has(callId)) return false;
      zeitpunkte.set(callId, jetztIso);
      return true;
    },
    async lies(callId) {
      return zeitpunkte.get(callId) ?? null;
    },
  };
}
