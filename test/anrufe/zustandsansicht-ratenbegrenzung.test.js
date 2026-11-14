import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { makeReadRoutes } from "../../src/routes/api-read.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { startServer, seedState } from "../helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_FEHLER = 500;
const GRENZE = 3;
const KALENDER_ANZEIGE = 10;
const STUNDE_MS = 3600000;
const MANDANT_KOPF = "x-test-mandant";

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

async function mitApp(store, lauf, { limitPerMin = 1000 } = {}) {
  const audits = [];
  const mandantAus = (req) => req.headers[MANDANT_KOPF] ?? BOOTSTRAP_TENANT_ID;
  const app = express();
  app.use(
    makeReadRoutes({
      store,
      config: withConfigNamespaces({ claudeModel: "claude-haiku-4-5", voiceEngine: "budget" }),
      audit: (...args) => audits.push(args),
      limitPerMin,
      tenant: {
        requestTenant: mandantAus,
        requireTenant: mandantAus,
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

const statusFolge = async (url, anzahl, optionen = {}) => {
  const folge = [];
  for (let nummer = 0; nummer < anzahl; nummer += 1) {
    const antwort = await abrufMitFrist(url, optionen);
    await antwort.text();
    folge.push(antwort.status);
  }
  return folge;
};

const ERLAUBT_DANN_GESPERRT = [...Array(GRENZE).fill(HTTP_OK), HTTP_TOO_MANY_REQUESTS];

for (const pfad of ["/api/state", "/api/tenant-data/export"]) {
  test(`${pfad}: nach ${GRENZE} Abrufen je Minute antwortet die Route mit 429`, async () => {
    await mitApp(
      speicher({ spaet: false }),
      async ({ base }) => {
        assert.deepEqual(await statusFolge(`${base}${pfad}`, GRENZE + 1), ERLAUBT_DANN_GESPERRT);
      },
      { limitPerMin: GRENZE },
    );
  });

  test(`${pfad}: das Limit zaehlt je Mandant, ein anderer Mandant bleibt frei`, async () => {
    await mitApp(
      speicher({ spaet: false }),
      async ({ base }) => {
        const url = `${base}${pfad}`;
        const a = { headers: { [MANDANT_KOPF]: "tenant_a" } };
        const b = { headers: { [MANDANT_KOPF]: "tenant_b" } };
        assert.deepEqual(await statusFolge(url, GRENZE + 1, a), ERLAUBT_DANN_GESPERRT);
        assert.deepEqual(await statusFolge(url, 1, b), [HTTP_OK]);
      },
      { limitPerMin: GRENZE },
    );
  });
}

test("Zustandsansicht und Export zaehlen getrennt: die erschoepfte Zustandsansicht sperrt den Export nicht", async () => {
  await mitApp(
    speicher({ spaet: false }),
    async ({ base }) => {
      assert.deepEqual(await statusFolge(`${base}/api/state`, GRENZE + 1), ERLAUBT_DANN_GESPERRT);
      assert.deepEqual(await statusFolge(`${base}/api/tenant-data/export`, 1), [HTTP_OK]);
    },
    { limitPerMin: GRENZE },
  );
});

test("am echten Server: RATE_LIMIT_PER_MIN begrenzt auch die lokalen Aufrufe von Zustandsansicht und Export", async () => {
  const srv = await startServer({
    env: { RATE_LIMIT_PER_MIN: String(GRENZE) },
    seed: seedState({}),
  });
  try {
    for (const pfad of ["/api/state", "/api/tenant-data/export"]) {
      assert.deepEqual(await statusFolge(`${srv.localUrl}${pfad}`, GRENZE + 1), ERLAUBT_DANN_GESPERRT, pfad);
    }
  } finally {
    await srv.stop();
  }
});

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

  test(`${pfad}: eine abgelehnte Zusage von ${name} landet im Fehlerhandler der Anwendung`, async () => {
    const store = speicher({ spaet: true });
    store[name] = () => Promise.reject(new Error("speicher spaet kaputt"));
    await mitApp(store, async ({ base }) => {
      const antwort = await abrufMitFrist(`${base}${pfad}`);
      assert.equal(antwort.status, HTTP_SERVER_FEHLER);
      assert.match(await antwort.text(), /speicher spaet kaputt/);
    });
  });
}

test("GET /api/state: der Kalender zeigt hoechstens die ersten zehn kommenden Termine", async () => {
  const store = speicher({ spaet: false });
  const kommende = Array.from({ length: KALENDER_ANZEIGE + 2 }, (_, i) => ({
    id: `t_${i}`,
    end: new Date(Date.now() + (i + 1) * STUNDE_MS).toISOString(),
  }));
  const vergangen = { id: "alt", end: new Date(Date.now() - STUNDE_MS).toISOString() };
  store.getCalendar = () => [vergangen, ...kommende];
  await mitApp(store, async ({ base }) => {
    const antwort = await abrufMitFrist(`${base}/api/state`);
    const body = await antwort.json();
    assert.deepEqual(
      body.calendar.map((termin) => termin.id),
      kommende.slice(0, KALENDER_ANZEIGE).map((termin) => termin.id),
    );
  });
});
