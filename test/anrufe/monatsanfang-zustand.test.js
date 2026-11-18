import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { makeReadRoutes } from "../../src/routes/api-read.ts";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

const ANRUF_ENDE_MAERZ = "2026-03-31T23:59:00.000Z";
const ANRUF_ANFANG_APRIL = "2026-04-01T00:00:00.000Z";
const ANRUF_MITTE_MAERZ = "2026-03-15T12:00:00.000Z";
const ANRUF_ANFANG_MAERZ = "2026-03-01T00:00:00.000Z";
const ANRUF_VOR_MAERZ = "2026-02-28T23:59:59.999Z";

const STARTZEITEN = [ANRUF_VOR_MAERZ, ANRUF_ANFANG_MAERZ, ANRUF_MITTE_MAERZ, ANRUF_ENDE_MAERZ, ANRUF_ANFANG_APRIL];
const auszug = () => ({ calls: [], actionItems: [], notifications: [] });

function speicher(abgefragt) {
  return {
    load: () => ({ calls: [], actionItems: [], notifications: [], numbers: [], usageEvents: [] }),
    tenantContext: () => ({ settings: {}, ownerName: "Jonas" }),
    exportTenantData: () => auszug(),
    exportTenantDataGelesen: () => auszug(),
    zaehleAnrufeSeit: (_tenantId, seitIso) => {
      abgefragt.push(seitIso);
      return STARTZEITEN.filter((start) => start >= seitIso).length;
    },
    usageOf: () => ({ inputTokens: 1, outputTokens: 2, costCents: 3, calls: 4 }),
    tenantSubscription: () => ({
      planSlug: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      periodCreditRevoked: false,
    }),
    getCalendar: () => [],
  };
}

async function zustandUm(t, jetztIso) {
  const abgefragt = [];
  const app = express();
  app.use(
    makeReadRoutes({
      store: speicher(abgefragt),
      config: withConfigNamespaces({ claudeModel: "claude-haiku-4-5", voiceEngine: "budget" }),
      audit: () => {},
      tenant: {
        requestTenant: () => BOOTSTRAP_TENANT_ID,
        requireTenant: () => BOOTSTRAP_TENANT_ID,
        tenantOwnsCall: () => true,
      },
    }),
  );
  const server = await new Promise((fertig) => {
    const s = app.listen(0, "127.0.0.1", () => fertig(s));
  });
  try {
    t.mock.timers.enable({ apis: ["Date"], now: new Date(jetztIso).getTime() });
    const antwort = await fetch(`http://127.0.0.1:${server.address().port}/api/state`);
    t.mock.timers.reset();
    return { json: await antwort.json(), abgefragt };
  } finally {
    t.mock.timers.reset();
    await new Promise((fertig) => server.close(fertig));
  }
}

test("MONATSANFANG: am 31.03. 23:59:59 UTC zaehlt callsThisMonth ab 2026-03-01T00:00:00.000Z", async (t) => {
  const { json, abgefragt } = await zustandUm(t, "2026-03-31T23:59:59Z");
  assert.deepEqual(abgefragt, [ANRUF_ANFANG_MAERZ]);
  assert.equal(json.usage.callsThisMonth, 4);
});

test("MONATSANFANG: am 01.04. 00:00:00 UTC zaehlt callsThisMonth ab 2026-04-01T00:00:00.000Z", async (t) => {
  const { json, abgefragt } = await zustandUm(t, "2026-04-01T00:00:00Z");
  assert.deepEqual(abgefragt, [ANRUF_ANFANG_APRIL]);
  assert.equal(json.usage.callsThisMonth, 1);
});
