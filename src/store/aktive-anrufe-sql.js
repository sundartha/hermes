import * as ops from "./state-ops.js";

const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, false)`;
const AKTIVE_SQL = `SELECT * FROM call WHERE tenant_id = $1 AND status = 'active' ORDER BY seq ASC`;
const FEHLER = "[pg] aktive anrufe lesen fehlgeschlagen:";

export function macheAktiveAnrufeSql({ runner, zeilenZuAnrufen }) {
  const ausDatenbank = (tenantId) =>
    runner
      .withClient(async (client) => {
        await client.query(KONTEXT_SQL, [tenantId]);
        return (await client.query(AKTIVE_SQL, [tenantId])).rows;
      })
      .catch((err) => {
        console.error(FEHLER, err.message);
        throw err;
      });
  return {
    async fuer(state, tenantId) {
      const zeilen = await ausDatenbank(tenantId);
      const gelesen = zeilenZuAnrufen(zeilen, [], []);
      const inDatenbank = new Set(gelesen.map((call) => call.id));
      const nurHier = ops.activeCallsFor(state, tenantId).filter((call) => !inDatenbank.has(call.id));
      return [...gelesen, ...nurHier];
    },
  };
}
