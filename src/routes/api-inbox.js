import { Router } from "express";
import { internalOnly } from "../wiring/internal-only.js";
import { lehneEingabeAb } from "../utils/http.js";

export const INBOX_MAX_ENTRIES = 20;

export function makeInboxRoutes({ store, audit, tenant }) {
  const { requireTenant } = tenant;
  const router = Router();

  router.post("/api/inbox/poll", internalOnly, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const { include_seen: seen, offset } = req.body ?? {};
    const includeSeen = seen === true;
    const skip = includeSeen && offset !== undefined ? offset : 0;
    if (lehneEingabeAb(res, !Number.isSafeInteger(skip) || skip < 0, "offset muss eine ganze Zahl ab 0 sein")) return;
    const page = store.takeInboxEntries(
      tenantId,
      skip > 0
        ? { limit: skip + INBOX_MAX_ENTRIES, includeSeen: true }
        : { limit: INBOX_MAX_ENTRIES, includeSeen },
    );
    const { remaining, marked } = page;
    const entries = page.entries.slice(skip);
    audit("inbox_poll", req, `neu=${marked} rest=${remaining}`);
    res.json({ entries, remaining });
  });

  return router;
}
