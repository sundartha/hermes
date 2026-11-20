import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID, makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";
import { makeBillingRoutes } from "../../src/routes/api-billing.ts";
import { speicherBereiche } from "../../src/store.js";
import { COST_TRUING_SOURCE } from "../../src/begriffe/abrechnung.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { operatorAuthPassThrough, startRouterApp } from "../operator-route-app.js";

const ANDERER_MANDANT = "t_bericht_zwei";
const HTTP_OK = 200;
const HTTP_INTERNAL = 500;
const TAG_MS = 86_400_000;
const MINUTE_MS = 60_000;
const DREI_TAGE_MS = 3 * TAG_MS;
const PRAEFIX_INLAND = "+49";
const BELEG_MIKRO_CENTS = 8_636_870;
const MONAT = "2026-11";
const ZEILEN_LESEN = "FROM call WHERE tenant_id";

const ROUTEN_KONFIG = withConfigNamespaces({
  kostenHeartbeatFensterH: 6,
  costTruingMinCoveragePercent: 80,
  costTruingDelayMinutes: 30,
  costTruingSweepIntervalMs: 3_600_000,
  voiceTariffDomesticPrefixes: [PRAEFIX_INLAND],
  voiceTariffDomesticCents: 0,
  providerToBucketRateMicro: 920000,
  costCalibrationMinSamples: 20,
  costDriftWarnPercent: 50,
});

const ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164, to_e164, goal,
  started_at, answered_at, ended_at, max_duration_s, provider, cost_trued_at, cost_trued_source,
  actual_cost_micro_cents, estimated_cost_spend_month_key)
  VALUES ($1, $2, $3, 'outbound', $4, $5, $6, 'Testziel', $7, $8, $9, 600, 'telnyx', $10, $11, $12, $13)`;

const vorVielen = (ms) => new Date(Date.now() - ms).toISOString();

async function imKontext(db, mandantId, arbeit) {
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [mandantId]);
  return arbeit();
}

async function legeAnrufAnderenInstanzAn(db, { id, mandant = BOOTSTRAP_TENANT_ID, ...felder }) {
  const f = {
    status: "completed",
    von: "+4930555000001",
    nach: "+4915155512345",
    start: vorVielen(DREI_TAGE_MS),
    angenommen: null,
    ende: null,
    belegtAm: null,
    herkunft: null,
    mikroCents: null,
    monat: null,
    ...felder,
  };
  await imKontext(db, mandant, () =>
    db.query(ANRUF_SQL, [id, mandant, `tok_${id}`, f.status, f.von, f.nach, f.start, f.angenommen, f.ende, f.belegtAm, f.herkunft, f.mikroCents, f.monat]),
  );
}

async function zweitenMandantAnlegen(db) {
  await imKontext(db, ANDERER_MANDANT, () => db.query(`INSERT INTO tenant (id, status) VALUES ($1, 'active')`, [ANDERER_MANDANT]));
}

function runnerFuer(db, lesefehler) {
  const client = {
    query: async (text, params) => {
      if (lesefehler.istAn() && text.includes(ZEILEN_LESEN)) throw new Error("bericht-lesen-ausgefallen");
      return db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  return { withClient: (fn) => fn(client) };
}

async function mitZweiteInstanz(lauf) {
  const db = await pgliteAlsRolleOhneSuperuser();
  let an = false;
  const lesefehler = { istAn: () => an, setze: (wert) => { an = wert; } };
  const store = makePgStore(runnerFuer(db, lesefehler));
  await store.init();
  await zweitenMandantAnlegen(db);
  return lauf({ db, store, lesefehler });
}

async function startRoutenApp(store) {
  const router = makeBillingRoutes({
    config: ROUTEN_KONFIG,
    store,
    audit: () => {},
    billing: {},
    tenant: {},
    costTruing: {},
    operatorAuth: operatorAuthPassThrough(),
  });
  return startRouterApp(router);
}

const holeJson = async (app, pfad) => (await abrufMitFrist(`${app.base}${pfad}`)).json();

test("BERICHT-SQL-KOSTENDECKUNG: /api/billing/kosten-deckung zaehlt nie beendete Anrufe beider Mandanten, die nur eine andere Instanz angelegt hat", async () => {
  await mitZweiteInstanz(async ({ db, store }) => {
    await legeAnrufAnderenInstanzAn(db, { id: "call_bericht_offen_1", status: "active" });
    await legeAnrufAnderenInstanzAn(db, { id: "call_bericht_offen_2", status: "active", mandant: ANDERER_MANDANT });
    const app = await startRoutenApp(store);
    try {
      const bericht = await holeJson(app, "/api/billing/kosten-deckung");
      assert.equal(bericht.nieBeendet, 2);
      assert.equal(store.load().calls.length, 0);
    } finally {
      await app.close();
    }
  });
});

test("BERICHT-SQL-DRIFT: /api/billing/cost-drift zaehlt einen Anruf einer anderen Instanz als Stichprobe", async () => {
  await mitZweiteInstanz(async ({ db, store }) => {
    await legeAnrufAnderenInstanzAn(db, {
      id: "call_bericht_drift",
      von: "+4930555000009",
      angenommen: vorVielen(11 * MINUTE_MS),
      ende: vorVielen(10 * MINUTE_MS),
      belegtAm: vorVielen(MINUTE_MS),
      herkunft: COST_TRUING_SOURCE.DETAIL_RECORDS,
      mikroCents: BELEG_MIKRO_CENTS,
    });
    const app = await startRoutenApp(store);
    try {
      const { prefixes } = await holeJson(app, "/api/billing/cost-drift");
      assert.deepEqual(prefixes.map((eintrag) => [eintrag.prefix, eintrag.samples]), [[PRAEFIX_INLAND, 1]]);
    } finally {
      await app.close();
    }
  });
});

test("BERICHT-SQL-LESEFEHLER: faellt das Lesen der Anrufe aus, antworten beide Berichte mit 500 und nicht mit einem leeren Bericht", async () => {
  await mitZweiteInstanz(async ({ store, lesefehler }) => {
    lesefehler.setze(true);
    const app = await startRoutenApp(store);
    try {
      for (const pfad of ["/api/billing/kosten-deckung", "/api/billing/cost-drift"]) {
        const antwort = await abrufMitFrist(`${app.base}${pfad}`);
        assert.equal(antwort.status, HTTP_INTERNAL, pfad);
      }
    } finally {
      await app.close();
    }
    lesefehler.setze(false);
    const wieder = await startRoutenApp(store);
    try {
      assert.equal((await abrufMitFrist(`${wieder.base}/api/billing/kosten-deckung`)).status, HTTP_OK);
    } finally {
      await wieder.close();
    }
  });
});

test("BERICHT-SQL-ABGLEICH-ZUSTAND: der Abgleich-Zustand des Sweeps enthaelt Anrufe einer anderen Instanz und wirft bei Lesefehler", async () => {
  await mitZweiteInstanz(async ({ db, store, lesefehler }) => {
    await legeAnrufAnderenInstanzAn(db, { id: "call_bericht_unbeantwortet", ende: vorVielen(MINUTE_MS) });
    const abgleich = speicherBereiche(store).kostenabgleich;
    assert.deepEqual((await abgleich.abgleichZustand()).calls.map((anruf) => anruf.id), ["call_bericht_unbeantwortet"]);
    lesefehler.setze(true);
    await assert.rejects(abgleich.abgleichZustand(), /bericht-lesen-ausgefallen/);
  });
});

test("BERICHT-SQL-QUERPRUEFUNG: die Monatssumme der Querpruefung enthaelt belegte Anrufe einer anderen Instanz und wirft bei Lesefehler", async () => {
  await mitZweiteInstanz(async ({ db, store, lesefehler }) => {
    await legeAnrufAnderenInstanzAn(db, {
      id: "call_bericht_monat",
      angenommen: vorVielen(11 * MINUTE_MS),
      ende: vorVielen(10 * MINUTE_MS),
      belegtAm: vorVielen(MINUTE_MS),
      herkunft: COST_TRUING_SOURCE.DETAIL_RECORDS,
      mikroCents: BELEG_MIKRO_CENTS,
      monat: MONAT,
    });
    const abgleich = speicherBereiche(store).kostenabgleich;
    const eingabe = { monthKey: MONAT, belegSummeJeTraeger: () => [] };
    assert.equal((await abgleich.querpruefungSummen(eingabe)).istGesamtMicroCents, BELEG_MIKRO_CENTS);
    lesefehler.setze(true);
    await assert.rejects(abgleich.querpruefungSummen(eingabe), /bericht-lesen-ausgefallen/);
  });
});
