export const ORPHAN_OUTCOME = Object.freeze({
  DROPPED: "dropped",
  ALIVE: "alive",
  KEPT_LAST: "kept_last",
  LOOKUP_FAILED: "lookup_failed",
  ANCHOR_FIXED: "anchor_fixed",
});

function groupByTenant(rows) {
  const byTenant = new Map();
  for (const row of rows) {
    const entry = byTenant.get(row.tenantId) || { tenantId: row.tenantId, idpSubject: row.idpSubject, accounts: [] };
    entry.accounts.push({ sub: row.sub, email: row.email });
    byTenant.set(row.tenantId, entry);
  }
  return [...byTenant.values()];
}

async function classifyAccounts(tenant, workos, logger) {
  const living = [];
  const dead = [];
  for (const account of tenant.accounts) {
    try {
      const exists = await workos.userExists(account.sub);
      (exists ? living : dead).push(account);
    } catch (err) {
      logger.warn(`[orphan-accounts] Abfrage fehlgeschlagen tenant=${tenant.tenantId}: ${err.message}`);
      return { lookupFailed: true, living: [], dead: [] };
    }
  }
  return { lookupFailed: false, living, dead };
}

function splitDroppable(living, dead) {
  if (living.length > 0) return { droppable: dead, kept: [] };
  return { droppable: dead.slice(1), kept: dead.slice(0, 1) };
}

function nextAnchor(survivors, idpSubject) {
  if (survivors.length === 0) return null;
  if (survivors.some((account) => account.sub === idpSubject)) return null;
  return survivors[survivors.length - 1];
}

async function reconcileTenant({ tenant, accounts, workos, apply, logger, report }) {
  const { lookupFailed, living, dead } = await classifyAccounts(tenant, workos, logger);
  if (lookupFailed) {
    report.errors.push({ tenantId: tenant.tenantId, reason: ORPHAN_OUTCOME.LOOKUP_FAILED });
    return;
  }
  for (const account of living) report.alive.push({ tenantId: tenant.tenantId, sub: account.sub });

  const { droppable, kept } = splitDroppable(living, dead);
  for (const account of kept) report.keptLast.push({ tenantId: tenant.tenantId, sub: account.sub });
  for (const account of droppable) {
    report.dropped.push({ tenantId: tenant.tenantId, sub: account.sub });
    if (apply) await accounts.dropAccount(account.sub);
  }

  const anchor = nextAnchor([...living, ...kept], tenant.idpSubject);
  if (!anchor) return;
  report.anchors.push({
    tenantId: tenant.tenantId,
    sub: anchor.sub,
    previous: tenant.idpSubject ?? null,
  });
  if (apply) await accounts.setIdpSubject(tenant.tenantId, anchor.sub);
}

export async function reconcileOrphanAccounts({ accounts, workos, apply = false, logger = console }) {
  const tenants = groupByTenant(await accounts.accountsForOrphanReconcile());
  const report = { apply, scanned: tenants.length, dropped: [], alive: [], keptLast: [], anchors: [], errors: [] };
  for (const tenant of tenants) {
    await reconcileTenant({ tenant, accounts, workos, apply, logger, report });
  }
  return report;
}
