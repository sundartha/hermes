const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, false)`;
const MANDANTEN_SQL = `SELECT id FROM tenant ORDER BY id`;
const KONVERSATION_SQL = `SELECT 1 FROM call WHERE tenant_id = $1 AND elevenlabs_conversation_id = $2 AND id <> $3 LIMIT 1`;
const MANDANT_SQL = `SELECT * FROM call WHERE tenant_id = $1 ORDER BY seq ASC`;
const MANDANT_SEIT_SQL = `SELECT * FROM call WHERE tenant_id = $1 AND ended_at >= $2 COLLATE "C" ORDER BY seq ASC`;
const FEHLER = "[pg] anruf-suche lesen fehlgeschlagen:";

export function macheAnrufSucheSql({ runner, zeilenZuAnrufen }) {
  const lesen = (arbeit) =>
    runner.withClient(arbeit).catch((err) => {
      console.error(FEHLER, err.message);
      throw err;
    });
  return {
    anderesMitKonversation: async (state, callId, konversationId) => {
      if (state.calls.some((call) => call.id !== callId && call.elevenlabsConversationId === konversationId)) return true;
      return lesen(async (client) => {
        for (const { id } of (await client.query(MANDANTEN_SQL)).rows) {
          await client.query(KONTEXT_SQL, [id]);
          const { rows } = await client.query(KONVERSATION_SQL, [id, konversationId, callId]);
          if (rows.length > 0) return true;
        }
        return false;
      });
    },
    anrufeDesMandanten: async (state, tenantId, seit) => {
      const gelesen = await lesen(async (client) => {
        await client.query(KONTEXT_SQL, [tenantId]);
        const abfrage = seit === undefined ? [MANDANT_SQL, [tenantId]] : [MANDANT_SEIT_SQL, [tenantId, seit]];
        return zeilenZuAnrufen((await client.query(...abfrage)).rows, [], []);
      });
      const inDatenbank = new Set(gelesen.map((call) => call.id));
      return [...gelesen, ...state.calls.filter((call) => call.tenantId === tenantId && !inDatenbank.has(call.id) && (seit === undefined || call.endedAt >= seit))];
    },
  };
}
