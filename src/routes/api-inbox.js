import { Router } from "express";
import { internalOnly } from "../wiring/internal-only.js";

export const INBOX_MAX_ENTRIES = 20;

export function makeInboxRoutes({ store, audit, tenant }) {
  const { requireTenant } = tenant;
  const router = Router();

  router.post("/api/inbox/poll", internalOnly, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const { include_seen: seen } = req.body ?? {};
    const includeSeen = seen === true;
    const { entries, remaining, marked } = store.takeInboxEntries(tenantId, {
      limit: INBOX_MAX_ENTRIES,
      includeSeen,
    });
    audit("inbox_poll", req, `neu=${marked} rest=${remaining}`);
    res.json({ entries, remaining });
  });

  return router;
}
