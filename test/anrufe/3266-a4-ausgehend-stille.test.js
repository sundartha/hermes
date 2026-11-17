import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  postTelnyxIncoming,
  seedCall,
  seedWithTelnyxNumber,
  startServer,
} from "../helpers.js";

const PUBLIC_URL = "https://agent.test";
const EL_STILLE_PFAD = "/brand/hermes-stille.wav";
const LAUT_URL = `${PUBLIC_URL}/brand/hermes-begruessungslaut.wav`;
const HTTP_OK = 200;
const EL_AN_ENV = Object.freeze({
  ELEVENLABS_INBOUND_ENABLED: "true",
  ELEVENLABS_INBOUND_TENANT_IDS: seedCall().tenantId,
  ...EL_INBOUND_ACCESS_BOOT_ENV,
});
const LAUT_AUS = Object.freeze({ ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED: "false" });

async function mitServer({ env, seed }, run) {
  const srv = await startServer({ env, seed });
  try {
    return await run(srv);
  } finally {
    await srv.stop();
  }
}

async function eingehendeUebergabeXml(env) {
  return mitServer({ env, seed: seedWithTelnyxNumber({ language: "de" }) }, async (srv) => {
    const antwort = await postTelnyxIncoming(srv, { callSid: "CA3266a4" });
    assert.equal(antwort.status, HTTP_OK);
    return antwort.text();
  });
}

const dialOeffnungVon = (xml) => xml.match(/<Dial[^>]*>/)?.[0] ?? "";

test("3266-A4-2: eingehende Uebergabe - keine Stille, Begruessungslaut wie bisher bzw. ohne audioUrl, wenn er aus ist", async () => {
  const mitLaut = await eingehendeUebergabeXml(EL_AN_ENV);
  assert.ok(dialOeffnungVon(mitLaut).includes(` audioUrl="${LAUT_URL}"`), mitLaut);
  assert.ok(!mitLaut.includes(EL_STILLE_PFAD), mitLaut);
  const ohneLaut = await eingehendeUebergabeXml({ ...EL_AN_ENV, ...LAUT_AUS });
  assert.ok(ohneLaut.includes("<Dial"), ohneLaut);
  assert.ok(!ohneLaut.includes("audioUrl"), ohneLaut);
});
