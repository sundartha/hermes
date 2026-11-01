import { test } from "node:test";
import assert from "node:assert/strict";

import { gesendeteAnfrage } from "../gemeinsam/gesendete-anfrage.mjs";

process.env.TELNYX_API_BASE = "https://telnyx.test";
process.env.TELNYX_API_KEY = "KEYtest-rechnungsabfrage-anfrage";

const { voiceControl } = await import("../../src/telephony/registry.js");

const RECHNUNGEN_JE_ABFRAGE = "12";

test("Telnyx-Rechnungsabfrage: fragt die zwölf neuesten Rechnungen beim Rechnungsendpunkt ab", async () => {
  const { ergebnis, urls } = await gesendeteAnfrage({ data: [] }, () =>
    voiceControl("telnyx").fetchMonthlyInvoiceTotal({ month: "2026-10" }),
  );

  assert.deepEqual(ergebnis, { ok: false, reason: "invoice_not_found" });
  assert.equal(urls.length, 1);
  assert.equal(urls[0].origin + urls[0].pathname, "https://telnyx.test/v2/invoices");
  assert.equal(urls[0].searchParams.get("sort"), "-period_start");
  assert.equal(urls[0].searchParams.get("page[size]"), RECHNUNGEN_JE_ABFRAGE);
});
