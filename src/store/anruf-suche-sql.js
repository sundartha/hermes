const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, false)`;
const MANDANTEN_SQL = `SELECT id FROM tenant ORDER BY id`;
const KONVERSATIONEN_SQL = `SELECT elevenlabs_conversation_id FROM call WHERE tenant_id = $1 AND elevenlabs_conversation_id = ANY($2) AND id <> $3`;
const MANDANT_SQL = `SELECT * FROM call WHERE tenant_id = $1 ORDER BY seq ASC`;
const MANDANT_SEIT_SQL = `SELECT * FROM call WHERE tenant_id = $1 AND ended_at >= $2 COLLATE "C" ORDER BY seq ASC`;
const FEHLER = "[pg] anruf-suche lesen fehlgeschlagen:";

export function macheAnrufSucheSql({ runner, zeilenZuAnrufen }) {
  const lesen = (arbeit) =>
    runner.withClient(arbeit).catch((err) => {
      console.error(FEHLER, err.message);
      throw err;
    });
  const stapel = new Map();
  const belegteKennungen = (callId, kennungen) =>
    lesen(async (client) => {
      const belegt = new Set();
      for (const { id } of (await client.query(MANDANTEN_SQL)).rows) {
        await client.query(KONTEXT_SQL, [id]);
        const { rows } = await client.query(KONVERSATIONEN_SQL, [id, kennungen, callId]);
        for (const zeile of rows) belegt.add(zeile.elevenlabs_conversation_id);
      }
      return belegt;
    });
  const arbeiteStapelAb = (callId) => {
    const wartende = stapel.get(callId);
    stapel.delete(callId);
    belegteKennungen(callId, wartende.map((eintrag) => eintrag.konversationId)).then(
      (belegt) => wartende.forEach((eintrag) => eintrag.ok(belegt.has(eintrag.konversationId))),
      (err) => wartende.forEach((eintrag) => eintrag.fehl(err)),
    );
  };
  const einreihenInStapel = (callId, konversationId) =>
    new Promise((ok, fehl) => {
      const eintrag = { konversationId, ok, fehl };
      if (stapel.has(callId)) return stapel.get(callId).push(eintrag);
      stapel.set(callId, [eintrag]);
      queueMicrotask(() => arbeiteStapelAb(callId));
    });
  return {
    anderesMitKonversation: async (state, callId, konversationId) => {
      if (state.calls.some((call) => call.id !== callId && call.elevenlabsConversationId === konversationId)) return true;
      return einreihenInStapel(callId, konversationId);
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
