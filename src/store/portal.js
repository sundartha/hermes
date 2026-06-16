// portalStore: per-Request, tenant-scopetes Read-Modul fuer den Kunden-Web-Pfad.
// Trennscharf vom synchronen Owner-Spiegel (store.js): eigener async Pfad, der pro
// Request EINE Transaktion mit gesetzter RLS-GUC (SET LOCAL) faehrt. Der einzige
// Weg an einen DB-Client ist withTenant() -> kein Query ohne vorheriges SET LOCAL
// (erzwungener Wrapper, Council Blocker #1). KEINE Pool-Konstruktion hier (DIP):
// der runner.withClient wird injiziert (portal-pool.js im Betrieb, pglite im Test).
export function makePortalStore(runner) {
  // Faehrt fn(client) in EINER Transaktion mit transaktionslokaler RLS-GUC. SET
  // LOCAL ist txn-scoped -> nach COMMIT/ROLLBACK auf der gepoolten Verbindung weg
  // (pgBouncer-Transaction-Pooling-sicher). Jeder Fehler -> ROLLBACK, GUC faellt.
  async function withTenant(tenantId, fn) {
    if (!tenantId) throw new Error("withTenant: tenantId Pflicht (fail-closed)");
    return runner.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
        const out = await fn(client);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    });
  }

  return {
    withTenant,
    // WHERE tenant_id = primaere Linie; RLS (SET LOCAL) = zweite Linie (Spec 3.3, Defense-in-Depth).
    listCalls: (tenantId) =>
      withTenant(tenantId, async (c) =>
        (await c.query(`SELECT id, direction, status, started_at, summary FROM call WHERE tenant_id = $1 ORDER BY seq DESC`, [tenantId])).rows
      ),
  };
}
