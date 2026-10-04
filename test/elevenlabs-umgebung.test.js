import assert from "node:assert/strict";
import test from "node:test";

import { consultAllowedForCall } from "../src/consult/gate.js";
import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import {
  placeCall,
  seedState,
  startServer,
  startServerExpectExit,
  TELNYX_TEST_OWNER_NUMBER,
} from "./helpers.js";
import { starteAufzeichnendeAttrappe } from "./helpers/aufzeichnende-attrappe.js";
import { sendeAnrufstartKoerper } from "./helpers/elevenlabs-anrufstart-attrappe.mjs";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const BOOT_VERWEIGERT = 1;
const START_PATH = "/v1/convai/sip-trunk/outbound-call";
const UMGEBUNG_VAR = "ELEVENLABS_ENVIRONMENT";

const EL_ENV = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_umgebung_test",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_umgebung_test",
  ELEVENLABS_API_KEY: "el-api-key-umgebung",
});

const ANRUFSTART_ANGENOMMEN = Object.freeze({
  status: HTTP_OK,
  koerper: { success: true, conversation_id: "conv_umgebung_1", sip_call_id: "sip_umgebung_1" },
});
const UNBEKANNT = Object.freeze({ status: HTTP_NOT_FOUND, koerper: {} });

const istAnrufstart = (pfad) => pfad.startsWith(START_PATH);
const elevenLabsAntwort = (pfad) => (istAnrufstart(pfad) ? ANRUFSTART_ANGENOMMEN : UNBEKANNT);

const umgebungIn = ({ config }) => config.voice.elevenLabsOutbound.environment;
const umgebungsFunde = ({ configFatalErrors }) =>
  configFatalErrors().filter((meldung) => meldung.includes(UMGEBUNG_VAR));

function mitUmgebung(config, environment) {
  const { voice } = config;
  const elevenLabsOutbound = { ...voice.elevenLabsOutbound, environment };
  return { ...config, voice: { ...voice, elevenLabsOutbound } };
}

const anrufstartIn = (environment) =>
  sendeAnrufstartKoerper({
    makeElevenLabsOutbound: (teile) =>
      makeElevenLabsOutbound({ ...teile, config: mitUmgebung(teile.config, environment) }),
    consultAllowedForCall,
  });

async function anrufstartMit(env) {
  const attrappe = await starteAufzeichnendeAttrappe(elevenLabsAntwort);
  const srv = await startServer({
    env: { ...EL_ENV, ELEVENLABS_API_BASE: attrappe.url, ...env },
    seed: seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }] }),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await placeCall(srv);
    assert.equal(res.status, HTTP_OK, await res.text());
    const starts = attrappe.anfragen.filter(({ pfad }) => istAnrufstart(pfad));
    assert.equal(starts.length, 1, "genau ein Anrufstart beim Anbieter");
    return JSON.parse(starts[0].rumpf).conversation_initiation_client_data;
  } finally {
    await srv.stop();
    await attrappe.schliesse();
  }
}

test("EL-UMGEBUNG a: ohne ELEVENLABS_ENVIRONMENT traegt der Anrufstart keinen Schluessel environment", async () => {
  const clientData = await anrufstartMit({});

  assert.ok(clientData.dynamic_variables, "dynamic_variables fehlt im Anrufstart");
  assert.equal(Object.hasOwn(clientData, "environment"), false);
});

test("EL-UMGEBUNG b: ELEVENLABS_ENVIRONMENT=staging schickt environment staging an den Anbieter", async () => {
  const clientData = await anrufstartMit({ ELEVENLABS_ENVIRONMENT: "staging" });

  assert.equal(clientData.environment, "staging");
});

test("EL-UMGEBUNG c: ELEVENLABS_ENVIRONMENT=production traegt keinen Schluessel environment", async () => {
  const clientData = await anrufstartMit({ ELEVENLABS_ENVIRONMENT: "production" });

  assert.ok(clientData.dynamic_variables, "dynamic_variables fehlt im Anrufstart");
  assert.equal(Object.hasOwn(clientData, "environment"), false);
});

test("EL-UMGEBUNG d: ein unbekannter Wert fuer ELEVENLABS_ENVIRONMENT verweigert den Start und nennt die Einstellung", async () => {
  const { code, output } = await startServerExpectExit({
    env: { ELEVENLABS_ENVIRONMENT: "Staging" },
  });

  assert.equal(code, BOOT_VERWEIGERT);
  assert.match(output, /Boot wird verweigert/);
  assert.match(output, /ELEVENLABS_ENVIRONMENT="Staging" ist unbekannt/);
});

test("EL-UMGEBUNG e: config.js liest ELEVENLABS_ENVIRONMENT und meldet nur unbekannte Werte", async () => {
  const gesetzt = process.env.ELEVENLABS_ENVIRONMENT;
  try {
    delete process.env.ELEVENLABS_ENVIRONMENT;
    const ohne = await import("../src/config.js?el-umgebung-ohne");
    process.env.ELEVENLABS_ENVIRONMENT = "production";
    const production = await import("../src/config.js?el-umgebung-production");
    process.env.ELEVENLABS_ENVIRONMENT = "staging";
    const staging = await import("../src/config.js?el-umgebung-staging");
    process.env.ELEVENLABS_ENVIRONMENT = "Staging";
    const unbekannt = await import("../src/config.js?el-umgebung-unbekannt");

    assert.deepEqual([ohne, production, staging, unbekannt].map(umgebungIn), [
      "production",
      "production",
      "staging",
      "production",
    ]);
    assert.deepEqual([ohne, production, staging].flatMap(umgebungsFunde), []);
    assert.deepEqual(umgebungsFunde(unbekannt), [
      'ELEVENLABS_ENVIRONMENT="Staging" ist unbekannt (gueltig: production|staging).',
    ]);
  } finally {
    if (gesetzt === undefined) delete process.env.ELEVENLABS_ENVIRONMENT;
    else process.env.ELEVENLABS_ENVIRONMENT = gesetzt;
  }
});

test("EL-UMGEBUNG f: der Anrufkoerper traegt environment nur ausserhalb von production", async () => {
  const production = await anrufstartIn("production");
  const staging = await anrufstartIn("staging");

  assert.equal(Object.hasOwn(production.conversation_initiation_client_data, "environment"), false);
  assert.equal(staging.conversation_initiation_client_data.environment, "staging");
});
