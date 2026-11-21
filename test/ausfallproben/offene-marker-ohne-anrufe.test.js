import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgTestStore } from "../pg-helpers.js";
import { speicherBereiche } from "../../src/store.js";
import { runPriceDriftSweep } from "../../src/billing/price-drift-watch.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

const ZEILEN_LESEN = "FROM call WHERE tenant_id";
const JETZT_MS = Date.parse("2026-09-11T00:00:00.000Z");
const CODES = ["price-drift:unbekannt:1"];

async function mitLesezaehler(lauf) {
  const { store, db, runner } = await makePgTestStore();
  const stand = { aus: false, lesungen: 0 };
  const client = {
    query: async (text, params) => {
      if (text.includes(ZEILEN_LESEN)) {
        stand.lesungen += 1;
        if (stand.aus) throw new Error("anrufe-lesen-ausgefallen");
      }
      return db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  runner.withClient = (fn) => fn(client);
  return lauf({ store, stand, ausfall: speicherBereiche(store).ausfall });
}

async function setzeMarker(ausfall, codes) {
  for (const code of codes) await ausfall.beanspruchMarker({ code, nowMs: JETZT_MS, istFaellig: () => true });
}

test("OFFENE-MARKER-PG: offeneMarkerListe liefert nur offene Marker und liest keine Anrufe", async () => {
  await mitLesezaehler(async ({ ausfall, stand }) => {
    await setzeMarker(ausfall, ["a:eins", "a:zwei"]);
    await ausfall.markerSchliessen({ code: "a:zwei", nowMs: JETZT_MS + 1 });
    stand.aus = true;
    const offen = await ausfall.offeneMarkerListe();
    assert.deepEqual(offen.map((marker) => marker.code), ["a:eins"]);
    assert.equal(offen[0].closedAt, null);
    assert.equal(stand.lesungen, 0);
  });
});

test("OFFENE-MARKER-PG: offeneAusfallZustand liefert weiter Anrufe und Marker und wirft bei Lesefehler", async () => {
  await mitLesezaehler(async ({ ausfall, stand }) => {
    await setzeMarker(ausfall, ["a:eins"]);
    const zustand = await ausfall.offeneAusfallZustand();
    assert.deepEqual(zustand.calls, []);
    assert.deepEqual(zustand.outageAlerts.map((marker) => marker.code), ["a:eins"]);
    stand.aus = true;
    await assert.rejects(ausfall.offeneAusfallZustand(), /anrufe-lesen-ausgefallen/);
  });
});

test("OFFENE-MARKER-JSON: offeneMarkerListe liefert genau die Marker mit closedAt null", async () => {
  const state = {
    calls: [],
    outageAlerts: [
      { code: "a:offen", closedAt: null },
      { code: "a:zu", closedAt: "2026-09-01T00:00:00.000Z" },
    ],
  };
  const store = { load: () => state, save: () => {}, withStoreLock: (fn) => fn() };
  const offen = await speicherBereiche(store).ausfall.offeneMarkerListe();
  assert.deepEqual(offen.map((marker) => marker.code), ["a:offen"]);
});

test("OFFENE-MARKER-SWEEP: der Preis-Drift-Sweep endet bei unlesbarer Anruftabelle ohne Fehler, zaehlt die Marker und liest keine Anrufe", async () => {
  await mitLesezaehler(async ({ store, ausfall, stand }) => {
    await setzeMarker(ausfall, CODES);
    stand.aus = true;
    stand.lesungen = 0;
    const audit = [];
    await runPriceDriftSweep({
      store,
      config: withConfigNamespaces({
        paymentEnabled: true,
        priceDriftMinIntervalMs: 86_400_000,
        priceDriftUnknownEscalateAfter: 3,
        stripeStarterPriceId: "price_starter",
        stripeBusinessPriceId: "price_business",
        platformAlertMailTo: "ops@example.invalid",
        outageAlertDebounceMs: 21_600_000,
        outageAlertRetryMs: 900_000,
      }),
      audit: (aktion, _akteur, detail) => audit.push([aktion, detail]),
      messaging: () => ({ sendSms: async () => {} }),
      mailer: { sendMail: async () => {} },
      lesePreis: async () => {
        throw new Error("Stripe nicht erreichbar");
      },
      anlass: "test",
      nowMs: JETZT_MS + 1,
    });
    assert.equal(stand.lesungen, 0);
    assert.deepEqual(audit.map(([aktion]) => aktion), ["price_drift_unknown"]);
    const offen = await ausfall.offeneMarkerListe();
    assert.deepEqual(
      offen.map((marker) => marker.code).filter((code) => code.startsWith("price-drift:unbekannt:")).sort(),
      ["price-drift:unbekannt:1", "price-drift:unbekannt:2"],
    );
  });
});
