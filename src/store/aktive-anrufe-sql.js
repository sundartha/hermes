import * as ops from "./state-ops.js";

const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, false)`;
const AKTIVE_SQL = `SELECT * FROM call WHERE tenant_id = $1 AND status = 'active' ORDER BY seq ASC`;
const FEHLER = "[pg] aktive anrufe lesen fehlgeschlagen:";

export function macheAktiveAnrufeSql({ runner, zeilenZuAnrufen, eigene }) {
  const staende = new WeakMap();
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
  const standVon = (state, tenantId) => {
    if (!staende.has(state)) staende.set(state, new Map());
    const je = staende.get(state);
    if (!je.has(tenantId)) je.set(tenantId, { aktive: [], gelesen: false });
    return je.get(tenantId);
  };
  return {
    async fuer(state, tenantId) {
      const stand = standVon(state, tenantId);
      stand.gelesen = false;
      const zeilen = await ausDatenbank(tenantId);
      const gelesen = zeilenZuAnrufen(zeilen, [], []);
      const inDatenbank = new Set(gelesen.map((call) => call.id));
      const nurHier = ops.activeCallsFor(state, tenantId).filter((call) => !inDatenbank.has(call.id));
      stand.aktive = [...gelesen, ...nurHier];
      stand.gelesen = true;
      return stand.aktive;
    },
    zaehlung(state, tenantId) {
      const hier = ops.activeCallsFor(state, tenantId).filter((call) => eigene.has(call.id));
      const stand = standVon(state, tenantId);
      const gemerkt = stand.gelesen ? [] : stand.aktive.filter((call) => !eigene.has(call.id));
      return [...hier, ...gemerkt];
    },
  };
}
