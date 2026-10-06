export function makePortalStore(runner) {
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
    listCalls: (tenantId) =>
      withTenant(
        tenantId,
        async (c) =>
          (
            await c.query(
              `SELECT id, direction, status, started_at, summary FROM call WHERE tenant_id = $1 ORDER BY seq DESC`,
              [tenantId],
            )
          ).rows,
      ),
  };
}
