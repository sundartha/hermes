import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { makeReadRoutes } from "../../src/routes/api-read.ts";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { startServer, seedState } from "../helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_FEHLER = 500;
const GRENZE = 3;
const KALENDER_ANZEIGE = 10;
const STUNDE_MS = 3600000;

const auszug = () => ({
  calls: [{ id: "call_1", tenantId: BOOTSTRAP_TENANT_ID, transcript: [] }],
  actionItems: [{ id: "a_1" }],
  notifications: [{ id: "n_1" }],
});

function speicher({ spaet }) {
  const antwort = (wert) => (spaet ? Promise.resolve(wert) : wert);
  return {
    load: () => ({ calls: [], actionItems: [], notifications: [], numbers: [], usageEvents: [] }),
    tenantContext: () => antwort({ settings: { greeting: "hallo" }, ownerName: "Jonas" }),
    exportTenantData: () => antwort(auszug()),
    exportTenantDataGelesen: () => antwort(auszug()),
    zaehleAnrufeSeit: () => 0,
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

const statusFolge = async (url, anzahl, optionen = {}) => {
  const folge = [];
  for (let nummer = 0; nummer < anzahl; nummer += 1) {
    const antwort = await abrufMitFrist(url, optionen);
    await antwort.text();
    folge.push(antwort.status);
  }
  return folge;
};

test("am echten Server: RATE_LIMIT_PER_MIN begrenzt auch die lokalen Aufrufe von Zustandsansicht und Export", async () => {
  const srv = await startServer({
    env: { RATE_LIMIT_PER_MIN: String(GRENZE) },
    seed: seedState({}),
  });
  try {
    for (const pfad of ["/api/state", "/api/tenant-data/export"]) {
      const url = `${srv.localUrl}${pfad}`;
      const mandant = (id) => ({ headers: { "x-internal-tenant": id } });
      const a = await statusFolge(url, GRENZE + 1, mandant(`${pfad}-a`));
      assert.ok(a.slice(0, GRENZE).every((status) => status !== HTTP_TOO_MANY_REQUESTS), `${pfad} ${a}`);
      assert.equal(a[GRENZE], HTTP_TOO_MANY_REQUESTS, pfad);
      const b = await statusFolge(url, 1, mandant(`${pfad}-b`));
      assert.notEqual(b[0], HTTP_TOO_MANY_REQUESTS, `${pfad}: anderer Mandant bleibt frei`);
    }
    assert.deepEqual(await statusFolge(`${srv.localUrl}/api/state`, 1, { headers: { "x-internal-tenant": "/api/tenant-data/export-a" } }), [HTTP_OK]);
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
  ["/api/tenant-data/export", "exportTenantDataGelesen"],
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

const LESE_E164 = "+49111";
const LESE_KALENDER = 10;
const LESE_NICHT_GEFUNDEN = 404;

const lesbarerAuszug = () => ({
  calls: [{ id: "call_1", tenantId: BOOTSTRAP_TENANT_ID, transcript: [], streamToken: "geheim" }],
  actionItems: [{ id: "a_1" }, { id: "a_2" }],
  notifications: [{ id: "n_1" }],
});

function lesespeicher(ueberschreibung = {}) {
  const zukunft = (nummer) => ({ id: `e${nummer}`, end: `2999-01-${String(nummer + 10)}T10:00:00.000Z` });
  const events = [{ id: "alt", end: "2000-01-01T00:00:00.000Z" }, ...Array.from({ length: 12 }, (_, nummer) => zukunft(nummer))];
  const aufgerufen = [];
  return {
    aufgerufen,
    load: () => ({
      numbers: [{ tenantId: BOOTSTRAP_TENANT_ID, status: "active", provider: "telnyx", e164: LESE_E164 }],
    }),
    tenantContext: () => ({ settings: {}, ownerName: "Jonas" }),
    exportTenantData: () => lesbarerAuszug(),
    exportTenantDataGelesen: () => lesbarerAuszug(),
    zaehleAnrufeSeit: () => 0,
    usageOf: () => ({ inputTokens: 1, outputTokens: 2, costCents: 3, calls: 4 }),
    tenantSubscription: () => ({ planSlug: null, currentPeriodStart: null, currentPeriodEnd: null, periodCreditRevoked: false }),
    getCalendar: () => events,
    getCall: (id) => (id === "call_1" ? { id, tenantId: BOOTSTRAP_TENANT_ID, streamToken: "geheim", transcript: [] } : undefined),
    leseCallUngebunden: async (id) => (id === "call_1" ? { id, tenantId: BOOTSTRAP_TENANT_ID, streamToken: "geheim", transcript: [] } : undefined),
    einstellungenNachladen: (mandant) => {
      aufgerufen.push(mandant);
    },
    ...ueberschreibung,
  };
}

async function mitLeseApp(store, lauf, { eigenerMandant = BOOTSTRAP_TENANT_ID, besitzt = true } = {}) {
  const audits = [];
  const app = express();
  app.use(
    makeReadRoutes({
      store,
      config: withConfigNamespaces({ claudeModel: "claude-haiku-4-5", voiceEngine: "budget" }),
      audit: (...args) => audits.push(args),
      tenant: {
        requestTenant: () => eigenerMandant,
        requireTenant: () => eigenerMandant,
        tenantOwnsCall: () => besitzt,
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

test("GET /api/state: Nummer, Nummernstatus, Kalenderfenster, Modell und Nachladen der Einstellungen (#3400)", async () => {
  const store = lesespeicher();
  await mitLeseApp(store, async ({ base }) => {
    const antwort = await abrufMitFrist(`${base}/api/state`);
    assert.equal(antwort.status, HTTP_OK);
    const body = await antwort.json();
    assert.equal(body.agent.number, LESE_E164);
    assert.equal(body.agent.numberStatus, "active");
    assert.equal(body.agent.model, "claude-haiku-4-5");
    assert.equal(body.agent.voiceEngine, "budget");
    assert.deepEqual(body.calendar.map((eintrag) => eintrag.id), Array.from({ length: LESE_KALENDER }, (_, nummer) => `e${nummer}`));
    assert.equal(body.usage.calls, 4);
    assert.deepEqual(body.actionItems, [{ id: "a_1" }, { id: "a_2" }]);
  });
  assert.deepEqual(store.aufgerufen, [BOOTSTRAP_TENANT_ID]);
});

test("GET /api/state: ein Mandant ohne Nummer bekommt leere Nummer (#3400)", async () => {
  await mitLeseApp(lesespeicher({ load: () => ({ numbers: [] }) }), async ({ base }) => {
    const body = await (await abrufMitFrist(`${base}/api/state`)).json();
    assert.equal(body.agent.number, "");
  });
});

test("GET /api/state: scheitert das Nachladen der Einstellungen, antwortet der Server mit dem Fehler (#3400)", async () => {
  const store = lesespeicher({ einstellungenNachladen: () => Promise.reject(new Error("nachladen kaputt")) });
  await mitLeseApp(store, async ({ base }) => {
    const antwort = await abrufMitFrist(`${base}/api/state`);
    assert.equal(antwort.status, HTTP_SERVER_FEHLER);
    assert.ok((await antwort.text()).includes("nachladen kaputt"));
  });
});

test("GET /api/state: ohne einstellungenNachladen am Speicher laeuft die Anfrage trotzdem durch (#3400)", async () => {
  await mitLeseApp(lesespeicher({ einstellungenNachladen: undefined }), async ({ base }) => {
    assert.equal((await abrufMitFrist(`${base}/api/state`)).status, HTTP_OK);
  });
});

test("GET /api/calls/:id: eigener Anruf ohne interne Felder, fremder oder unbekannter Anruf 404 (#3400)", async () => {
  await mitLeseApp(lesespeicher(), async ({ base }) => {
    const gefunden = await abrufMitFrist(`${base}/api/calls/call_1`);
    assert.equal(gefunden.status, HTTP_OK);
    const body = await gefunden.json();
    assert.equal(body.id, "call_1");
    assert.equal("streamToken" in body, false);
    const unbekannt = await abrufMitFrist(`${base}/api/calls/call_9`);
    assert.equal(unbekannt.status, LESE_NICHT_GEFUNDEN);
    assert.deepEqual(await unbekannt.json(), { error: "not found" });
  });
  await mitLeseApp(
    lesespeicher(),
    async ({ base }) => {
      const fremd = await abrufMitFrist(`${base}/api/calls/call_1`);
      assert.equal(fremd.status, LESE_NICHT_GEFUNDEN);
      assert.deepEqual(await fremd.json(), { error: "not found" });
    },
    { besitzt: false },
  );
});

test("GET /api/tenant-data/export: Audit-Zeile mit den Zahlen, Anrufe ohne interne Felder (#3400)", async () => {
  await mitLeseApp(lesespeicher(), async ({ base, audits }) => {
    const body = await (await abrufMitFrist(`${base}/api/tenant-data/export`)).json();
    assert.equal("streamToken" in body.calls[0], false);
    assert.equal(audits.length, 1);
    assert.equal(audits[0][0], "data_export");
    assert.equal(audits[0][2], "calls=1 actionItems=2 notifications=1");
  });
});
