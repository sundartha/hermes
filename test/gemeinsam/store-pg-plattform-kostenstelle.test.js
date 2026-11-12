import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore, makePgStore } from "../pg-helpers.js";

const PLATFORM_TTS_TENANT = "platform:play-tts";
const NOW_ISO = "2026-11-08T10:00:00.000Z";
const ERSTE_ZEICHEN = 238;
const WEITERE_ZEICHEN = 100;
const SINGLETON_ID = 1;

async function neuGeoeffnet(runner) {
  const geoeffnet = makePgStore(runner);
  await geoeffnet.init();
  return geoeffnet;
}

async function mitGeflushtenZeichen() {
  const { store, db, runner } = await makePgTestStore();
  store.recordTtsCharacters(ERSTE_ZEICHEN, NOW_ISO);
  await store.drainFlushes();
  return { store, db, runner };
}

async function zaehlen(db, tabelle, spalte) {
  const ergebnis = await db.query(`SELECT count(*)::int AS n FROM ${tabelle} WHERE ${spalte} = $1`, [
    PLATFORM_TTS_TENANT,
  ]);
  return ergebnis.rows[0].n;
}

test("Kostenstelle platform:play-tts behaelt ihre Zeichen ueber einen Neustart", async () => {
  const { runner } = await mitGeflushtenZeichen();

  const geoeffnet = await neuGeoeffnet(runner);

  assert.equal(geoeffnet.usageOf(PLATFORM_TTS_TENANT).ttsCharacters, ERSTE_ZEICHEN);
});

test("Kostenstelle platform:play-tts wird nach dem Neustart fortgeschrieben, nicht ueberschrieben", async () => {
  const { runner } = await mitGeflushtenZeichen();
  const geoeffnet = await neuGeoeffnet(runner);

  geoeffnet.recordTtsCharacters(WEITERE_ZEICHEN, NOW_ISO);
  await geoeffnet.drainFlushes();
  const nochmalGeoeffnet = await neuGeoeffnet(runner);

  assert.equal(nochmalGeoeffnet.usageOf(PLATFORM_TTS_TENANT).ttsCharacters, ERSTE_ZEICHEN + WEITERE_ZEICHEN);
});

test("Kostenstelle platform:play-tts legt keinen Schein-Mandanten in tenant oder usage an", async () => {
  const { db } = await mitGeflushtenZeichen();

  assert.equal(await zaehlen(db, "tenant", "id"), 0);
  assert.equal(await zaehlen(db, "usage", "tenant_id"), 0);
});

test("Kostenstelle platform:play-tts steht in platform_tts_usage.kostenstelle_zeichen", async () => {
  const { db } = await mitGeflushtenZeichen();

  const ergebnis = await db.query(`SELECT kostenstelle_zeichen FROM platform_tts_usage WHERE id = $1`, [
    SINGLETON_ID,
  ]);

  assert.equal(Number(ergebnis.rows[0].kostenstelle_zeichen), ERSTE_ZEICHEN);
});
