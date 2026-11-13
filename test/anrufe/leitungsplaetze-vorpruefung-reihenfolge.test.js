import assert from "node:assert/strict";
import test from "node:test";

import express from "express";
import { makeLeitungsplaetze } from "../../src/store.js";
import { makeCallRoutes } from "../../src/routes/api-calls.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makePgTestStore } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { anrufeSql, mitHermesAufPostgres, neueAnrufe, postgresVorhanden } from "./hermes-mit-postgres.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY = 429;
const HTTP_UNAVAILABLE = 503;
const AUFTRAG = "Tisch fuer zwei reservieren (Vorpruefung)";
const RESERVE_CENTS = 60;
const EL_PLAETZE = 4;
const TELNYX_PLAETZE = 90;
const PLATZ_SQL = `INSERT INTO leitungsplatz (call_id, anbieter, tenant_id, ablauf_um)
  VALUES ($1, 'elevenlabs', $2, now() + interval '1 hour')`;
const SPERRE_NEHMEN_SQL = "SELECT pg_advisory_lock(2665, 1)";
const SPERRE_GEBEN_SQL = "SELECT pg_advisory_unlock(2665, 1)";
const ANRUF_ANZAHL_SQL = "SELECT count(*)::int AS anzahl FROM call";
const DB_WARTEGRENZE_MS = 10_000;
const ziel = (nummer) => `+4915112340${String(nummer).padStart(3, "0")}`;

async function fuelleElevenLabsPlaetze(sql) {
  for (let index = 0; index < EL_PLAETZE; index += 1) await sql(PLATZ_SQL, [`voll_${index}`, `t_voll_${index}`]);
}

const rufeAnWartend = (srv) =>
  abrufMitFrist(
    `${srv.localUrl}/api/calls`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: ziel(1), objective: AUFTRAG }),
    },
    { wartezeitMs: DB_WARTEGRENZE_MS },
  );

test("B3: bei OUTBOUND_FROZEN und voller Plattform antwortet POST /api/calls 403 frozen statt 503 ausgelastet", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitHermesAufPostgres(t, { env: { OUTBOUND_FROZEN: "true" } }, async ({ srv, anbieter, sql }) => {
    await fuelleElevenLabsPlaetze(sql);
    const antwort = await neueAnrufe().rufeAn(srv);
    assert.equal(antwort.status, HTTP_FORBIDDEN);
    assert.equal((await antwort.json()).reason, "frozen");
    assert.equal(anbieter.starts().length, 0);
  });
});

test("S14: antwortet die Datenbank nicht, lehnt POST /api/calls mit 503 ab, startet nichts beim Anbieter und legt keinen Anruf an", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitHermesAufPostgres(t, { env: {} }, async ({ srv, anbieter, sql }) => {
    await sql(SPERRE_NEHMEN_SQL);
    let antwort;
    try {
      antwort = await rufeAnWartend(srv);
    } finally {
      await sql(SPERRE_GEBEN_SQL);
    }
    assert.equal(antwort.status, HTTP_UNAVAILABLE);
    assert.equal(anbieter.starts().length, 0);
    assert.equal((await sql(ANRUF_ANZAHL_SQL)).rows[0].anzahl, 0);
    const spaeter = await neueAnrufe().rufeAn(srv);
    assert.equal(spaeter.status, HTTP_OK);
    assert.equal((await anrufeSql(sql, 1)).length, 1);
  });
});

const routenConfig = withConfigNamespaces({
  outboundFrozen: false,
  assistantContextEnabled: false,
  paymentEnabled: false,
  platformSpendCapCents: 800,
  allowedCountryCodes: ["+49"],
  maxCallsPerHour: 100,
  perTargetWindowMs: 3600000,
  perTargetCallCap: 100,
  multiTenant: false,
  diagnosticRetentionDays: 0,
  ownerSelfCallEnabled: false,
  ownerSelfCallTenantIds: [],
  elevenLabsOutbound: { enabled: false },
  telnyxAssistant: { enabled: false },
  voiceEngine: "budget",
  publicUrl: "http://127.0.0.1:1",
});

const BUDGET_ALT = {
  PRECALL_BRIEFING_ENABLED: "false",
  ASSISTANT_CONTEXT_ENABLED: "false",
  IN_CALL_CONSULT_ENABLED: "false",
  CONSULT_ENABLED: "false",
  METRICS_ENABLED: "false",
};

function reserveZaehler(store) {
  const zaehler = { reserviert: 0, zurueck: [] };
  const tor = {
    name: "reserve",
    run(ctx) {
      Object.assign(ctx, {
        tenantId: "T",
        fromNumber: "+491700000000",
        outboundProvider: "telnyx",
        reserveCents: RESERVE_CENTS,
        maxDur: 60,
        requestedBy: "test",
      });
      zaehler.reserviert += 1;
      return null;
    },
  };
  const beobachtet = {
    ...store,
    releaseOutboundReserveCents: (tenantId, cents) => {
      zaehler.zurueck.push(cents);
      return store.releaseOutboundReserveCents(tenantId, cents);
    },
  };
  return { zaehler, tor, beobachtet };
}

async function starteRoute(leitungsplaetze) {
  Object.assign(process.env, BUDGET_ALT);
  const { store } = await makePgTestStore();
  const { zaehler, tor, beobachtet } = reserveZaehler(store);
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      store: beobachtet,
      leitungsplaetze,
      config: routenConfig,
      audit: () => {},
      outboundGates: [tor],
      callQuotaDenial: () => null,
      voiceControl: () => ({ originateCall: async () => ({ sid: "sid_vorpruefung" }), endCall: async () => {} }),
      originateElevenLabsCall: async () => {},
      terminateAndBillCall: async () => {},
      hangUpAction: () => null,
      billThunk: () => () => {},
      finishCall: () => {},
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
      tenant: { requestTenant: () => "T", requireTenant: () => "T", tenantOwnsCall: () => true },
      consultDelivery: { waitForEvent: async () => ({}) },
      internalIdentity: () => null,
      OWNER_ID: "owner",
    }),
  );
  const server = await new Promise((resolve) => {
    const laufend = app.listen(0, "127.0.0.1", () => resolve(laufend));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/calls`;
  const post = async (to) => {
    const res = await abrufMitFrist(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, objective: AUFTRAG }),
    });
    return { status: res.status, body: await res.json() };
  };
  return { post, zaehler, stop: () => new Promise((fertig) => server.close(fertig)) };
}

async function mitRoute(wandle, lauf) {
  const platz = makeLeitungsplaetze();
  const route = await starteRoute(wandle(platz));
  try {
    await lauf({ route, platz });
  } finally {
    await route.stop();
  }
}

const unveraendert = (platz) => platz;
const pruefenMeldetVoll = (platz) => ({
  ...platz,
  pruefenAusgehend: async () => "anbieter_voll",
  belegenAusgehend: async () => ({ entscheidung: "anbieter_voll" }),
});
const belegenWirftFehler = (platz) => ({
  ...platz,
  belegenAusgehend: async () => {
    throw new Error("Datenbank antwortet nicht");
  },
});

async function belegeAllePlaetze(platz) {
  for (let index = 0; index < TELNYX_PLAETZE; index += 1)
    await platz.belegenAusgehend({ callId: `vorbelegt_${index}`, tenantId: "x", weg: "telnyx", maxDauerS: 100000 });
}

test("T2: die Ablehnung an der Kunden-Hoechstzahl gibt die Budget-Reserve genau einmal zurueck", async () => {
  await mitRoute(unveraendert, async ({ route }) => {
    assert.equal((await route.post(ziel(1))).status, HTTP_OK);
    assert.equal((await route.post(ziel(2))).status, HTTP_OK);
    const abgelehnt = await route.post(ziel(3));
    assert.equal(abgelehnt.status, HTTP_TOO_MANY);
    assert.equal(abgelehnt.body.reason, "gleichzeitig_limit");
    assert.equal(route.zaehler.reserviert, 3);
    assert.deepEqual(route.zaehler.zurueck, [RESERVE_CENTS]);
  });
});

test("T2: die Ablehnung bei voller Plattform gibt die Budget-Reserve genau einmal zurueck", async () => {
  await mitRoute(unveraendert, async ({ route, platz }) => {
    await belegeAllePlaetze(platz);
    const abgelehnt = await route.post(ziel(1));
    assert.equal(abgelehnt.status, HTTP_UNAVAILABLE);
    assert.equal(abgelehnt.body.reason, "ausgelastet");
    assert.deepEqual(route.zaehler.zurueck, [RESERVE_CENTS]);
  });
});

test("T2: meldet die Datenbank beim Pruefen anbieter_voll, kommt 503 ausgelastet und die Reserve geht genau einmal zurueck", async () => {
  await mitRoute(pruefenMeldetVoll, async ({ route }) => {
    const abgelehnt = await route.post(ziel(1));
    assert.equal(abgelehnt.status, HTTP_UNAVAILABLE);
    assert.equal(abgelehnt.body.reason, "ausgelastet");
    assert.deepEqual(route.zaehler.zurueck, [RESERVE_CENTS]);
  });
});

test("T2: wirft das Belegen einen Fehler, kommt 503 ohne Anrufdatensatz und die Reserve geht genau einmal zurueck", async () => {
  await mitRoute(belegenWirftFehler, async ({ route }) => {
    const abgelehnt = await route.post(ziel(1));
    assert.equal(abgelehnt.status, HTTP_UNAVAILABLE);
    assert.match(abgelehnt.body.error, /nicht gewaehlt/);
    assert.deepEqual(route.zaehler.zurueck, [RESERVE_CENTS]);
  });
});

test("B4: dasselbe laufende Ziel beim Kunden an der Hoechstzahl meldet 200 deduplicated, die Reserve geht genau einmal zurueck", async () => {
  await mitRoute(unveraendert, async ({ route }) => {
    await route.post(ziel(1));
    await route.post(ziel(2));
    const wieder = await route.post(ziel(2));
    assert.equal(wieder.status, HTTP_OK);
    assert.equal(wieder.body.deduplicated, true);
    assert.deepEqual(route.zaehler.zurueck, [RESERVE_CENTS]);
  });
});

test("B6: dasselbe laufende Ziel bei voller Plattform meldet 200 deduplicated, die Reserve geht genau einmal zurueck", async () => {
  await mitRoute(unveraendert, async ({ route, platz }) => {
    const erster = await route.post(ziel(1));
    assert.equal(erster.status, HTTP_OK);
    await belegeAllePlaetze(platz);
    const wieder = await route.post(ziel(1));
    assert.equal(wieder.status, HTTP_OK);
    assert.equal(wieder.body.deduplicated, true);
    assert.equal(wieder.body.callId, erster.body.callId);
    assert.deepEqual(route.zaehler.zurueck, [RESERVE_CENTS]);
  });
});
