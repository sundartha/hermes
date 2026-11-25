import assert from "node:assert/strict";
import { test } from "node:test";

import { oeffneSpeicherAn } from "../gemeinsam/speicher-oeffnen.js";

process.env.STORE_BACKEND = "pg";
process.env.DATABASE_URL = "postgres://attrappe.invalid/hermes";
const { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } = await import("../pg-helpers.js");
const { poolAufPglite } = await import("../abrechnung/server-mit-testdatenbank.js");
const { withConfigNamespaces } = await import("../config-namespaces-helper.js");
const { waitUntil, withFetch } = await import("../helpers.js");
const { CONVERSATION_IN_PROGRESS, ERROR_ENVELOPES } = await import("../fixtures/elevenlabs-conversations.js");
const speicherDb = await pgliteAlsRolleOhneSuperuser();
poolAufPglite(speicherDb);
const speicher = await import("../../src/store.js").then(oeffneSpeicherAn);
const { elevenlabsOutbound } = await import("../../src/elevenlabs/registry.ts");

const MANDANT_PRAEFIX = "t_fehlerserie_kunde";
let mandant = MANDANT_PRAEFIX;
let nummer = 0;
const ZIEL = "+4915112346142";
const ABSENDER = "+4930555006142";
const KONVERSATION = "conv_fehlerserie_6142";
const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;
const SCHREIBUNGEN_JE_ABRUF = 2;

const NICHT_GEFUNDEN = {
  ok: false,
  status: ERROR_ENVELOPES.notFound.httpStatus,
  json: async () => ERROR_ENVELOPES.notFound.body,
};
const SERVERFEHLER = { ok: false, status: HTTP_SERVER_ERROR, json: async () => ({}) };
const LAEUFT = { ok: true, status: HTTP_OK, json: async () => CONVERSATION_IN_PROGRESS };

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

const terminateAndBillCall = async ({ persistEnd, bill }) => {
  await persistEnd();
  await bill();
};

async function neueInstanz(db, ueberschreibung = {}) {
  const pgStore = makePgStoreMitSperre(runnerFuer(db));
  await pgStore.init();
  const zaehler = { fristen: 0, beendet: 0 };
  const store = {
    ...pgStore,
    fortschreibeFehlerserie: speicher.fortschreibeFehlerserie,
    setzeAbfrageFrist: async (anfrage) => {
      await speicher.setzeAbfrageFrist(anfrage);
      zaehler.fristen += 1;
    },
    leitungsplaetze: { freigeben: () => {} },
    releaseOutboundReserve: async () => {},
    recordUsageEvent: () => {},
    ...ueberschreibung,
  };
  const el = elevenlabsOutbound().makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({ elevenLabsOutbound: { apiKey: "test-key", apiBase: "https://el.test", resultPollMs: 5 } }),
    terminateAndBillCall,
    billThunk: () => () => {
      zaehler.beendet += 1;
    },
    finishCall: () => {},
  });
  return { store, el, zaehler };
}

async function aufbau(zweiteUeberschreibung) {
  nummer += 1;
  mandant = `${MANDANT_PRAEFIX}_${nummer}`;
  const db = speicherDb;
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [mandant]);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [mandant]);
  const a = await neueInstanz(db);
  const b = await neueInstanz(db, zweiteUeberschreibung);
  const call = a.store.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: mandant });
  call.elevenlabsConversationId = KONVERSATION;
  await a.store.persistCall(call.id);
  await a.store.markAnswered(call.id);
  await b.store.attachActiveCall(call.id);
  return { db, a, b, callId: call.id };
}

const statusDerZeile = async (db, callId) => {
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [mandant]);
  const { rows } = await db.query(`SELECT status FROM call WHERE id = $1`, [callId]);
  return rows[0].status;
};

async function pollen(instanz, callId, antwort) {
  const vorher = instanz.zaehler.fristen;
  await withFetch(
    async () => antwort,
    async () => {
      await instanz.el.abfrageDurchLauf(callId);
      await waitUntil(() => instanz.zaehler.fristen >= vorher + SCHREIBUNGEN_JE_ABRUF || instanz.zaehler.beendet > 0);
    },
  );
}

test("Fehlerserie in der Zeile: zwei permanente Fehler auf Instanz A, der dritte auf Instanz B beendet den Anruf", async () => {
  const { db, a, b, callId } = await aufbau();
  await pollen(a, callId, NICHT_GEFUNDEN);
  await pollen(a, callId, NICHT_GEFUNDEN);
  assert.equal(await statusDerZeile(db, callId), "active");
  await pollen(b, callId, NICHT_GEFUNDEN);
  assert.equal(await statusDerZeile(db, callId), "failed");
});

const ZURUECKSETZER = [
  { name: "ein Abruf ohne Ergebnis, aber erfolgreich", dazwischen: LAEUFT },
  { name: "ein nicht-permanenter Fehler", dazwischen: SERVERFEHLER },
];

for (const fall of ZURUECKSETZER) {
  test(`Fehlerserie in der Zeile: ${fall.name} setzt den Zaehler auf 0, erst drei permanente Fehler danach beenden den Anruf`, async () => {
    const { db, a, b, callId } = await aufbau();
    await pollen(a, callId, NICHT_GEFUNDEN);
    await pollen(a, callId, NICHT_GEFUNDEN);
    await pollen(b, callId, fall.dazwischen);
    await pollen(a, callId, NICHT_GEFUNDEN);
    await pollen(b, callId, NICHT_GEFUNDEN);
    assert.equal(await statusDerZeile(db, callId), "active");
    await pollen(a, callId, NICHT_GEFUNDEN);
    assert.equal(await statusDerZeile(db, callId), "failed");
  });
}

test("Fehlerserie in der Zeile: schlaegt die Datenbank beim Zaehlen fehl, steht der Fehler im Log, der Abruf laeuft weiter und der Anruf wird nie beendet", async () => {
  const { db, callId } = await aufbau();
  const kaputt = await neueInstanz(db, {
    fortschreibeFehlerserie: async () => {
      throw new Error("db weg");
    },
  });
  await kaputt.store.attachActiveCall(callId);
  const zeilen = [];
  const original = console.error;
  console.error = (...teile) => zeilen.push(teile.map(String).join(" "));
  try {
    for (let i = 0; i < 4; i += 1) await pollen(kaputt, callId, NICHT_GEFUNDEN);
  } finally {
    console.error = original;
  }
  assert.equal(await statusDerZeile(db, callId), "active");
  assert.ok(zeilen.some((zeile) => zeile.includes("[fristen] Fehlerserie schreiben fehlgeschlagen:") && zeile.includes("db weg")));
});

test("Fehlerserie in der Zeile: ein Zuruecksetzen bei Zaehler 0 trifft keine Zeile, bei Zaehler 1 liefert es 0", async () => {
  const { callId } = await aufbau();
  const anfrage = (permanent) => ({ callId, tenantId: mandant, permanent });
  assert.equal(await speicher.fortschreibeFehlerserie(anfrage(false)), undefined);
  assert.equal(await speicher.fortschreibeFehlerserie(anfrage(true)), 1);
  assert.equal(await speicher.fortschreibeFehlerserie(anfrage(false)), 0);
  assert.equal(await speicher.fortschreibeFehlerserie(anfrage(false)), undefined);
});
