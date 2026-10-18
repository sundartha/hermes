import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { makeReadRoutes } from "../../src/routes/api-read.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const OWNER_TENANT = "owner";
const CALL_ID = "call_intern_felder";
const SENTINEL = "GEHEIM-";

const INTERNE_FELDER = [
  "streamToken",
  "_finished",
  "summarySmsSentAt",
  "summaryMailSentAt",
  "telnyxConversationId",
  "callerTurns",
  "estimatedCostCents",
  "estimatedCostSpendMonthKey",
  "estimatedCostPeriodKey",
  "actualCostMicroCents",
  "costTruedAt",
  "costTruedSource",
  "costTruingAttempts",
  "inboxEntryAt",
  "inboxSeenAt",
  "fromRegistrationSource",
  "costProfile",
  "elDetectorCounts",
  "webhookAnchors",
  "elBoundAt",
  "elFallbackAt",
  "elNachlaufStartedAt",
];

function anrufMitInternenFeldern() {
  const internes = Object.fromEntries(INTERNE_FELDER.map((feld) => [feld, `${SENTINEL}${feld}`]));
  return {
    id: CALL_ID,
    tenantId: OWNER_TENANT,
    objective: "Friseurtermin",
    status: "completed",
    summary: "Termin steht",
    ...internes,
  };
}

async function liesEinzelanruf(anruf) {
  const tenant = {
    requestTenant: () => OWNER_TENANT,
    requireTenant: () => OWNER_TENANT,
    tenantOwnsCall: (call, tenantId) => call.tenantId === tenantId,
  };
  const store = { getCall: (id) => (id === anruf.id ? anruf : undefined) };
  const app = express();
  app.use(makeReadRoutes({ store, config: {}, audit: () => {}, tenant }));
  const server = await new Promise((listening) => {
    const http = app.listen(0, () => listening(http));
  });
  try {
    const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/calls/${anruf.id}`);
    assert.equal(antwort.status, HTTP_OK);
    return await antwort.json();
  } finally {
    await new Promise((closed) => server.close(closed));
  }
}

test("Anrufansicht: GET /api/calls/:id zeigt keines der 22 internen Felder und lässt den Rest unverändert", async () => {
  const ansicht = await liesEinzelanruf(anrufMitInternenFeldern());

  assert.deepEqual(ansicht, {
    id: CALL_ID,
    tenantId: OWNER_TENANT,
    objective: "Friseurtermin",
    status: "completed",
    summary: "Termin steht",
  });
  for (const feld of INTERNE_FELDER) {
    assert.ok(!(feld in ansicht), `leakt das interne Feld ${feld}`);
  }
  assert.ok(!JSON.stringify(ansicht).includes(SENTINEL), "leakt einen Wert eines internen Feldes");
});
