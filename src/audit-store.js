export function makeAuditStore(runner) {
  return {
    record: ({ actorSub = null, tenantId = null, action, detail = null }) =>
      runner.withClient((c) =>
        c.query(
          `INSERT INTO audit_log (actor_sub, tenant_id, action, detail) VALUES ($1,$2,$3,$4)`,
          [actorSub, tenantId, action, detail],
        ),
      ),
  };
}
