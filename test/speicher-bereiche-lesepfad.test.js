import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { makeReadRoutes } from "../src/routes/api-read.js";
import { BOOTSTRAP_TENANT_ID } from "../src/begriffe/mandant.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_SERVER_FEHLER = 500;

function speicher({ spaet }) {
  const antwort = (wert) => (spaet ? Promise.resolve(wert) : wert);
  return {
    load: () => ({ calls: [], actionItems: [], notifications: [], numbers: [], usageEvents: [] }),
    tenantContext: () => antwort({ settings: { greeting: "hallo" }, ownerName: "Jonas" }),
    exportTenantData: () =>
      antwort({
        calls: [{ id: "call_1", tenantId: BOOTSTRAP_TENANT_ID, transcript: [] }],
        actionItems: [{ id: "a_1" }],
        notifications: [{ id: "n_1" }],
      }),
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

async function mitApp(store, lauf) {
  const audits = [];
  const app = express();
  app.use(
    makeReadRoutes({
      store,
      config: withConfigNamespaces({ claudeModel: "claude-haiku-4-5", voiceEngine: "budget" }),
      audit: (...args) => audits.push(args),
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
    await lauf({ base: `http://127.0.0.1:${server.address().port}`, audits });
  } finally {
    await new Promise((fertig) => server.close(fertig));
  }
}

for (const spaet of [false, true]) {
  const art = spaet ? "asynchron" : "synchron";

  test(`GET /api/state: Einstellungen, Besitzer und Daten aus dem Speicher (${art})`, async () => {
    await mitApp(speicher({ spaet }), async ({ base }) => {
      const antwort = await abrufMitFrist(`${base}/api/state`);
      assert.equal(antwort.status, HTTP_OK);
      const body = await antwort.json();
      assert.deepEqual(body.settings, { greeting: "hallo" });
      assert.equal(body.agent.owner, "Jonas");
      assert.deepEqual(body.calls.map((anruf) => anruf.id), ["call_1"]);
      assert.deepEqual(body.actionItems, [{ id: "a_1" }]);
      assert.deepEqual(body.notifications, [{ id: "n_1" }]);
    });
  });

  test(`GET /api/tenant-data/export: Export und Audit-Zeile (${art})`, async () => {
    await mitApp(speicher({ spaet }), async ({ base, audits }) => {
      const antwort = await abrufMitFrist(`${base}/api/tenant-data/export`);
      assert.equal(antwort.status, HTTP_OK);
      const body = await antwort.json();
      assert.deepEqual(body.calls.map((anruf) => anruf.id), ["call_1"]);
      assert.deepEqual(body.actionItems, [{ id: "a_1" }]);
      assert.deepEqual(audits, [["data_export", audits[0][1], "calls=1 actionItems=1 notifications=1"]]);
    });
  });
}

for (const [pfad, name] of [
  ["/api/state", "tenantContext"],
  ["/api/state", "exportTenantData"],
  ["/api/tenant-data/export", "exportTenantData"],
]) {
  test(`${pfad}: ein Wurf von ${name} landet im Fehlerhandler der Anwendung`, async () => {
    const store = speicher({ spaet: false });
    store[name] = () => {
      throw new Error("speicher kaputt");
    };
    await mitApp(store, async ({ base }) => {
      const antwort = await abrufMitFrist(`${base}${pfad}`);
      assert.equal(antwort.status, HTTP_SERVER_FEHLER);
      assert.match(await antwort.text(), /speicher kaputt/);
    });
  });
}

test("GET /api/state: der Kalender zeigt höchstens die ersten zehn kommenden Termine", async () => {
  const store = speicher({ spaet: false });
  const kommende = Array.from({ length: 12 }, (_, i) => ({
    id: `t_${i}`,
    end: new Date(Date.now() + (i + 1) * 3600000).toISOString(),
  }));
  const vergangen = { id: "alt", end: new Date(Date.now() - 3600000).toISOString() };
  store.getCalendar = () => [vergangen, ...kommende];
  await mitApp(store, async ({ base }) => {
    const antwort = await abrufMitFrist(`${base}/api/state`);
    const body = await antwort.json();
    assert.deepEqual(
      body.calendar.map((termin) => termin.id),
      kommende.slice(0, 10).map((termin) => termin.id),
    );
  });
});
