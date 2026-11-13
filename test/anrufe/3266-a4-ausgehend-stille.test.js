import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  postTelnyxIncoming,
  seedCall,
  seedState,
  seedWithTelnyxNumber,
  startServer,
} from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const PUBLIC_URL = "https://agent.test";
const EL_STILLE_PFAD = "/brand/hermes-stille.wav";
const STILLE_URL = `${PUBLIC_URL}${EL_STILLE_PFAD}`;
const LAUT_URL = `${PUBLIC_URL}/brand/hermes-begruessungslaut.wav`;
const KLINGELFRIST_S = 10;
const HTTP_OK = 200;
const PCM_FORMAT = 1;
const WAV_KOPF_BYTES = 44;
const BYTES_JE_PROBE = 2;
const ABTASTRATE_HZ = 8000;
const EL_AN_ENV = Object.freeze({
  ELEVENLABS_INBOUND_ENABLED: "true",
  ELEVENLABS_INBOUND_TENANT_IDS: seedCall().tenantId,
  ...EL_INBOUND_ACCESS_BOOT_ENV,
});
const LAUT_AUS = Object.freeze({ ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED: "false" });

const ausgehenderCall = () =>
  seedCall({ id: "call_3266_a4", provider: "telnyx", costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI, streamToken: "a".repeat(32) });

async function mitServer({ env, seed }, run) {
  const srv = await startServer({ env, seed });
  try {
    return await run(srv);
  } finally {
    await srv.stop();
  }
}

async function ausgehendeUebergabeXml(env) {
  return mitServer({ env, seed: seedState({ calls: [ausgehenderCall()] }) }, async (srv) => {
    const antwort = await abrufMitFrist(`${srv.localUrl}/voice/outbound?callId=${ausgehenderCall().id}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallSid: "v3:a4" }).toString(),
    });
    assert.equal(antwort.status, HTTP_OK);
    return antwort.text();
  });
}

async function eingehendeUebergabeXml(env) {
  return mitServer({ env, seed: seedWithTelnyxNumber({ language: "de" }) }, async (srv) => {
    const antwort = await postTelnyxIncoming(srv, { callSid: "CA3266a4" });
    assert.equal(antwort.status, HTTP_OK);
    return antwort.text();
  });
}

const dialOeffnungVon = (xml) => xml.match(/<Dial[^>]*>/)?.[0] ?? "";

test("3266-A4-1: ausgehende Uebergabe - Dial spielt die Stille statt Rufton oder Begruessungslaut", async () => {
  for (const env of [EL_AN_ENV, { ...EL_AN_ENV, ...LAUT_AUS }]) {
    const xml = await ausgehendeUebergabeXml(env);
    const dial = dialOeffnungVon(xml);
    assert.ok(dial.includes(` audioUrl="${STILLE_URL}"`), xml);
    assert.ok(!xml.includes(LAUT_URL), xml);
    assert.ok(!dial.includes("ringTone"), xml);
    assert.ok(xml.includes("<Sip"), xml);
  }
});

test("3266-A4-2: eingehende Uebergabe - keine Stille, Begruessungslaut wie bisher bzw. ohne audioUrl, wenn er aus ist", async () => {
  const mitLaut = await eingehendeUebergabeXml(EL_AN_ENV);
  assert.ok(dialOeffnungVon(mitLaut).includes(` audioUrl="${LAUT_URL}"`), mitLaut);
  assert.ok(!mitLaut.includes(EL_STILLE_PFAD), mitLaut);
  const ohneLaut = await eingehendeUebergabeXml({ ...EL_AN_ENV, ...LAUT_AUS });
  assert.ok(ohneLaut.includes("<Dial"), ohneLaut);
  assert.ok(!ohneLaut.includes("audioUrl"), ohneLaut);
});

test("3266-A4-3: die Stille-Datei ist PCM 16 bit mono 8000 Hz, nur Nullproben und mindestens so lang wie die Klingelfrist", () => {
  const datei = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "public", EL_STILLE_PFAD));
  assert.equal(datei.toString("ascii", 0, 4), "RIFF");
  assert.equal(datei.toString("ascii", 8, 12), "WAVE");
  assert.equal(datei.readUInt16LE(20), PCM_FORMAT);
  assert.equal(datei.readUInt16LE(22), 1);
  assert.equal(datei.readUInt32LE(24), ABTASTRATE_HZ);
  assert.equal(datei.readUInt16LE(34), BYTES_JE_PROBE * 8);
  const daten = datei.subarray(WAV_KOPF_BYTES);
  assert.ok(daten.length / BYTES_JE_PROBE / ABTASTRATE_HZ >= KLINGELFRIST_S, `${daten.length} Bytes`);
  assert.ok(daten.every((byte) => byte === 0), "nur Nullproben");
});
