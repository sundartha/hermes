import { Router, type Request, type Response } from "express";
import { internalOnly } from "../wiring/internal-only.js";
import { z } from "zod";
import { lehneEingabeAb } from "../utils/http.js";
import { pruefeKoerper } from "../utils/eingabe-pruefen.js";

export const INBOX_MAX_ENTRIES = 20;

const POLL_KOERPER = z.object({ include_seen: z.unknown(), offset: z.unknown() }).catch({});

interface Abhaengigkeiten {
  store: {
    takeInboxEntries: (
      tenantId: string,
      optionen: { limit: number; includeSeen: boolean },
    ) => { entries: unknown[]; remaining: number; marked: number };
  };
  audit: (aktion: string, req: Request, detail: string) => void;
  tenant: { requireTenant: (req: Request, res: Response) => string | null | undefined };
}

export function makeInboxRoutes({ store, audit, tenant }: Abhaengigkeiten): Router {
  const { requireTenant } = tenant;
  const router = Router();

  router.post("/api/inbox/poll", internalOnly, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const { include_seen: seen, offset } = POLL_KOERPER.parse(pruefeKoerper(res, { schema: POLL_KOERPER }, req.body));
    const includeSeen = seen === true;
    const skip = includeSeen && offset !== undefined ? offset : 0;
    if (typeof skip !== "number" || !Number.isSafeInteger(skip) || skip < 0) {
      lehneEingabeAb(res, true, "offset muss eine ganze Zahl ab 0 sein");
      return;
    }
    const page = store.takeInboxEntries(
      tenantId,
      skip > 0
        ? { limit: skip + INBOX_MAX_ENTRIES, includeSeen: true }
        : { limit: INBOX_MAX_ENTRIES, includeSeen },
    );
    const { remaining, marked } = page;
    const entries = page.entries.slice(skip);
    audit("inbox_poll", req, `neu=${String(marked)} rest=${String(remaining)}`);
    res.json({ entries, remaining });
  });

  return router;
}
