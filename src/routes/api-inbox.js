import { Router } from "express";
import { internalOnly } from "../wiring/internal-only.js";
import { z } from "zod";
import { lehneEingabeAb } from "../utils/http.js";
import { pruefeKoerper } from "../utils/eingabe-pruefen.js";

export const INBOX_MAX_ENTRIES = 20;

const POLL_KOERPER = z.object({ include_seen: z.unknown(), offset: z.unknown() }).catch({});

export function makeInboxRoutes({ store, audit, tenant }) {
  const { requireTenant } = tenant;
  const router = Router();

  router.post("/api/inbox/poll", internalOnly, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const { include_seen: seen, offset } = pruefeKoerper(res, { schema: POLL_KOERPER }, req.body);
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
