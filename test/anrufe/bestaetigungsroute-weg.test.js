import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_NOT_FOUND = 404;
const MODULE_NOT_FOUND = "ERR_MODULE_NOT_FOUND";
const AUFTRAG = { to: "+4915112345678", objective: "Termin vereinbaren" };

test("K-3a POST /api/call-confirmations antwortet 404 (auch intern) und startet keinen Anruf", async () => {
  const srv = await startServer({ env: { FAKE_ORIGINATE: "true" } });
  try {
    const antwort = await abrufMitFrist(`${srv.localUrl}/api/call-confirmations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(AUFTRAG),
    });
    assert.equal(antwort.status, HTTP_NOT_FOUND);
    assert.equal(srv.readStore().calls.length, 0, "kein Anruf angelegt");
  } finally {
    await srv.stop();
  }
});

test("K-3b die Bestaetigungs-Bibliothek und -Route lassen sich nicht mehr laden; der Server startet ohne sie (K-3a)", async () => {
  await assert.rejects(import("../../src/call-confirmation.js"), { code: MODULE_NOT_FOUND });
  await assert.rejects(import("../../src/routes/api-call-confirmations.js"), { code: MODULE_NOT_FOUND });
});
