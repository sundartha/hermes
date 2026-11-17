import assert from "node:assert/strict";
import { test } from "node:test";
import { makeFristenLauf } from "../../src/telephony/fristen-lauf.ts";
import { POLL_MS, baueElMitStore } from "../_iel-inbound-harness.js";
import { withFetch } from "../helpers.js";

const TAKT_MS = 15_000;
const UEBERNAHME_MS = 30_000;
const JETZT_MS = Date.parse("2031-03-04T05:06:07.000Z");
const ANRUF = "call_abfrage_lease";
const MANDANT = "tenant_abfrage_lease";

function speicherMitLease() {
  const jetzt = new Date(JETZT_MS).toISOString();
  const call = {
    id: ANRUF,
    tenantId: MANDANT,
    status: "active",
    elevenlabsConversationId: "conv_abfrage_lease",
    answeredAt: jetzt,
    startedAt: jetzt,
    endedAt: null,
  };
  const zeile = { faelligMs: JETZT_MS, leaseBisMs: 0 };
  const store = {
    getCall: () => call,
    leseCall: async () => call,
    load: () => ({ calls: [call] }),
    addTranscript: () => {},
    faelligeFristen: async ({ art, leaseMs }) => {
      const jetztMs = Date.now();
      if (art !== "abfrage" || zeile.faelligMs === null || zeile.faelligMs > jetztMs || zeile.leaseBisMs > jetztMs) return [];
      zeile.leaseBisMs = jetztMs + leaseMs;
      return [{ callId: ANRUF, tenantId: MANDANT, faelligAt: new Date(zeile.faelligMs).toISOString(), versuche: 1 }];
    },
    setzeAbfrageFrist: async ({ faelligAt }) => {
      zeile.faelligMs = faelligAt === null ? null : Date.parse(faelligAt);
    },
  };
  return { store, zeile };
}

const prozess = (store) => {
  const el = baueElMitStore(store);
  const lauf = makeFristenLauf({ store, beende: async () => {}, limitJeMandant: 5, leaseMs: TAKT_MS, abfrage: { poll: el.pollFrist } });
  return { el, lauf };
};

const abwarten = () => new Promise((erfuellen) => setImmediate(erfuellen));

const haengendeAbfrage = () => {
  const stand = { abrufe: 0, freigeben: [] };
  const antwort = async () => {
    stand.abrufe += 1;
    if (stand.abrufe === stand.haengtAb) await new Promise((weiter) => stand.freigeben.push(weiter));
    return { ok: true, status: 200, json: async () => ({ status: "in-progress", transcript: [], metadata: { call_duration_secs: 0 } }) };
  };
  return { stand, antwort };
};

test("Abfrage-Lease: haengt der Abruf laenger als die Lease, holt ein zweiter Lauf die Zeile nicht erneut und die Frist steht in der Zukunft", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: JETZT_MS });
  const { store, zeile } = speicherMitLease();
  const { stand, antwort } = haengendeAbfrage();
  stand.haengtAb = 1;
  const erster = prozess(store);
  const zweiter = prozess(store);
  await withFetch(antwort, async () => {
    const erstesErgebnis = erster.lauf.abfrageTakt();
    await abwarten();
    t.mock.timers.tick(TAKT_MS + 1);
    const zweitesErgebnis = await zweiter.lauf.abfrageTakt();
    assert.deepEqual(zweitesErgebnis, { beendet: 0, offen: 0, gelesen: true });
    assert.equal(stand.abrufe, 1);
    assert.ok(zeile.faelligMs > Date.now() + UEBERNAHME_MS);
    for (const weiter of stand.freigeben) weiter();
    await erstesErgebnis;
  });
});

test("Abfrage-Lease: der Timer des Besitzers laeuft mit haengendem Abruf, ein fremder Lauf uebernimmt den Anruf nicht", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: JETZT_MS });
  const { store, zeile } = speicherMitLease();
  const { stand, antwort } = haengendeAbfrage();
  stand.haengtAb = 2;
  const besitzer = prozess(store);
  const fremder = prozess(store);
  await withFetch(antwort, async () => {
    await besitzer.lauf.abfrageTakt();
    await abwarten();
    t.mock.timers.tick(POLL_MS);
    await abwarten();
    assert.equal(stand.abrufe, 2);
    t.mock.timers.tick(UEBERNAHME_MS + 1000);
    await fremder.lauf.abfrageTakt();
    assert.equal(stand.abrufe, 2);
    assert.ok(zeile.faelligMs > Date.now() + UEBERNAHME_MS);
    for (const weiter of stand.freigeben) weiter();
    await abwarten();
  });
});
