import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore, makePgStore, BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";

const PLATFORM_TTS_TENANT = "platform:play-tts";
const NOW_ISO = "2026-11-08T10:00:00.000Z";
const KEIN_ZYKLUS_DATUM = "kein-datum";
const PLATFORM_CHARS = 238;
const TENANT_CHARS = 729;
const MONATSSCHLUESSEL = "2026-10";
const VOICE_MINUTE_KIND = "voice_minute";
const VOICE_MINUTEN = 3;

async function mitFlushZaehler() {
  const { store, runner } = await makePgTestStore();
  await store.drainFlushes();
  const echt = runner.withClient.bind(runner);
  const zaehler = {
    aufrufe: 0,
    zuruecksetzen() {
      this.aufrufe = 0;
    },
  };
  runner.withClient = (arbeit) => {
    zaehler.aufrufe += 1;
    return echt(arbeit);
  };
  return { store, runner, zaehler };
}

async function neuGeoeffnet(runner) {
  const geoeffnet = makePgStore(runner);
  await geoeffnet.init();
  return geoeffnet;
}

async function flushesDurch(store, zaehler, aktion) {
  await store.drainFlushes();
  zaehler.zuruecksetzen();
  const ergebnis = aktion();
  await store.drainFlushes();
  return { ergebnis, flushes: zaehler.aufrufe };
}

test("recordTtsCharacters persistiert Plattform-Zeichen und Zyklusschluessel ueber einen Neustart", async () => {
  const { store, runner } = await mitFlushZaehler();
  store.recordTtsCharacters(PLATFORM_CHARS, NOW_ISO);
  assert.equal(store.usageOf(PLATFORM_TTS_TENANT).ttsCharacters, PLATFORM_CHARS);
  await store.drainFlushes();

  const geoeffnet = await neuGeoeffnet(runner);
  assert.equal(geoeffnet.platformTtsUsageView(NOW_ISO).characters, PLATFORM_CHARS);
});

test("recordTtsCharacters ohne Zyklusschluessel flusht nicht", async () => {
  const { store, zaehler } = await mitFlushZaehler();
  const { flushes } = await flushesDurch(store, zaehler, () =>
    store.recordTtsCharacters(PLATFORM_CHARS, KEIN_ZYKLUS_DATUM),
  );
  assert.equal(flushes, 0);
});

test("recordTenantTtsCharacters persistiert die Mandanten-Zeichen ueber einen Neustart", async () => {
  const { store, runner } = await mitFlushZaehler();
  store.recordTenantTtsCharacters(BOOTSTRAP_TENANT_ID, TENANT_CHARS);
  await store.drainFlushes();

  const geoeffnet = await neuGeoeffnet(runner);
  assert.equal(geoeffnet.usageOf(BOOTSTRAP_TENANT_ID).ttsCharacters, TENANT_CHARS);
});

test("recordTenantTtsCharacters mit 0 Zeichen flusht nicht", async () => {
  const { store, zaehler } = await mitFlushZaehler();
  const { flushes } = await flushesDurch(store, zaehler, () =>
    store.recordTenantTtsCharacters(BOOTSTRAP_TENANT_ID, 0),
  );
  assert.equal(flushes, 0);
});

test("recordRelayTtsCharacters persistiert Mandanten- und Plattform-Zeichen ueber einen Neustart", async () => {
  const { store, runner } = await mitFlushZaehler();
  store.recordRelayTtsCharacters(BOOTSTRAP_TENANT_ID, TENANT_CHARS, NOW_ISO);
  await store.drainFlushes();

  const geoeffnet = await neuGeoeffnet(runner);
  assert.equal(geoeffnet.usageOf(BOOTSTRAP_TENANT_ID).ttsCharacters, TENANT_CHARS);
  assert.equal(geoeffnet.platformTtsUsageView(NOW_ISO).characters, TENANT_CHARS);
});

test("recordRelayTtsCharacters mit 0 Zeichen flusht nicht", async () => {
  const { store, zaehler } = await mitFlushZaehler();
  const { flushes } = await flushesDurch(store, zaehler, () =>
    store.recordRelayTtsCharacters(BOOTSTRAP_TENANT_ID, 0, NOW_ISO),
  );
  assert.equal(flushes, 0);
});

test("markCostCrossCheckAttempted persistiert den Monatsschluessel ueber einen Neustart", async () => {
  const { store, runner } = await mitFlushZaehler();
  store.markCostCrossCheckAttempted(MONATSSCHLUESSEL);
  await store.drainFlushes();

  const geoeffnet = await neuGeoeffnet(runner);
  assert.equal(geoeffnet.load().costCrossCheck.lastCheckedMonthKey, MONATSSCHLUESSEL);
});

test("markCostCrossCheckAttempted flusht beim zweiten Aufruf mit unveraendertem Stand nicht", async () => {
  const { store, zaehler } = await mitFlushZaehler();
  store.markCostCrossCheckAttempted(MONATSSCHLUESSEL);
  const { flushes } = await flushesDurch(store, zaehler, () =>
    store.markCostCrossCheckAttempted(MONATSSCHLUESSEL),
  );
  assert.equal(flushes, 0);
});

test("markMeterEventsSent persistiert die Meter-Markierung ueber einen Neustart", async () => {
  const { store, runner } = await mitFlushZaehler();
  const ereignis = store.recordUsageEvent({
    tenantId: BOOTSTRAP_TENANT_ID,
    kind: VOICE_MINUTE_KIND,
    quantity: VOICE_MINUTEN,
    costCents: 0,
  });
  await store.drainFlushes();

  const gesendet = store.markMeterEventsSent([ereignis.id]);
  await store.drainFlushes();

  assert.equal(gesendet, 1);
  const geoeffnet = await neuGeoeffnet(runner);
  assert.deepEqual(geoeffnet.pendingMeterEvents(), []);
});

test("markMeterEventsSent flusht bei bereits gesendetem oder unbekanntem Ereignis nicht", async () => {
  const { store, zaehler } = await mitFlushZaehler();
  const ereignis = store.recordUsageEvent({
    tenantId: BOOTSTRAP_TENANT_ID,
    kind: VOICE_MINUTE_KIND,
    quantity: VOICE_MINUTEN,
    costCents: 0,
  });
  store.markMeterEventsSent([ereignis.id]);

  const bereitsGesendet = await flushesDurch(store, zaehler, () => store.markMeterEventsSent([ereignis.id]));
  const unbekannt = await flushesDurch(store, zaehler, () => store.markMeterEventsSent(["ue_unbekannt"]));

  assert.equal(bereitsGesendet.ergebnis, 0);
  assert.equal(bereitsGesendet.flushes, 0);
  assert.equal(unbekannt.ergebnis, 0);
  assert.equal(unbekannt.flushes, 0);
});
