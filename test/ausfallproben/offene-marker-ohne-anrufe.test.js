import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgTestStore } from "../pg-helpers.js";
import { speicherBereiche } from "../../src/store.js";

const ZEILEN_LESEN = "FROM call WHERE tenant_id";
const JETZT_MS = Date.parse("2026-09-11T00:00:00.000Z");

async function mitLesezaehler(lauf) {
  const { store, db, runner } = await makePgTestStore();
  let aus = false;
  let lesungen = 0;
  const stand = { gelesen: () => lesungen, ausschalten: () => { aus = true; } };
  const client = {
    query: async (text, params) => {
      if (text.includes(ZEILEN_LESEN)) {
        lesungen += 1;
        if (aus) throw new Error("anrufe-lesen-ausgefallen");
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
    stand.ausschalten();
    const offen = await ausfall.offeneMarkerListe();
    assert.deepEqual(offen.map((marker) => marker.code), ["a:eins"]);
    assert.equal(offen[0].closedAt, null);
    assert.equal(stand.gelesen(), 0);
  });
});

test("OFFENE-MARKER-PG: offeneAusfallZustand liefert weiter Anrufe und Marker und wirft bei Lesefehler", async () => {
  await mitLesezaehler(async ({ ausfall, stand }) => {
    await setzeMarker(ausfall, ["a:eins"]);
    const zustand = await ausfall.offeneAusfallZustand();
    assert.deepEqual(zustand.calls, []);
    assert.deepEqual(zustand.outageAlerts.map((marker) => marker.code), ["a:eins"]);
    stand.ausschalten();
    await assert.rejects(ausfall.offeneAusfallZustand(), /anrufe-lesen-ausgefallen/);
  });
});

test("OFFENE-MARKER-JSON: offeneMarkerListe liefert genau die Marker mit closedAt null", async () => {
  const { store } = await makePgTestStore();
  const ausfall = speicherBereiche({ ...store, ausfallSql: undefined }).ausfall;
  await ausfall.beanspruchMarker({ code: "a:offen", nowMs: JETZT_MS, istFaellig: () => true });
  await ausfall.beanspruchMarker({ code: "a:zu", nowMs: JETZT_MS, istFaellig: () => true });
  await ausfall.markerSchliessen({ code: "a:zu", nowMs: JETZT_MS + 1 });
  const offen = await ausfall.offeneMarkerListe();
  assert.deepEqual(offen.map((marker) => marker.code), ["a:offen"]);
});
