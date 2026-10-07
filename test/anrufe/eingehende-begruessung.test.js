import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  startServer,
  seedState,
  OWNER_TEST_FIRST_NAME,
  OWNER_TEST_NUMBER,
  postTelnyxIncoming,
  seedWithTelnyxNumber,
  normalizeIncomingTexml,
  EL_INBOUND_ACCESS_BOOT_ENV,
} from "../helpers.js";

const TENANT_B = "B";
const B_NUMBER = "+4915255555555";

function seedWithB(sprache = {}) {
  return seedState({
    tenants: [{ id: TENANT_B, status: "active", ownerName: "Maria" }],
    numbers: [
      {
        id: "num_b",
        e164: B_NUMBER,
        tenantId: TENANT_B,
        provider: "telnyx",
        status: "active",
        ...sprache,
        providerNumberId: null,
      },
    ],
  });
}

test("Inbound auf Tenant-B-Nummer -> Begruessung nennt B's ownerName", async () => {
  const srv = await startServer({ seed: seedWithB() });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAb", From: "+4915112345678", To: B_NUMBER }),
    });
    assert.equal(res.status, HTTP_OK);
    assert.match(await res.text(), /Maria/);
  } finally {
    await srv.stop();
  }
});

test("Inbound auf Owner-Nummer -> Begruessung nennt weiter Jonas (byte-identisch)", async () => {
  const srv = await startServer({ seed: seedWithB() });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({
        CallSid: "CAo",
        From: "+4915112345678",
        To: OWNER_TEST_NUMBER.e164,
      }),
    });
    assert.equal(res.status, HTTP_OK);
    assert.match(await res.text(), new RegExp(OWNER_TEST_FIRST_NAME));
  } finally {
    await srv.stop();
  }
});

const TELNYX_HEADERS = { "telnyx-signature-ed25519": "sig", "telnyx-timestamp": "1" };
const EL_ENV = {
  TELNYX_ELEVENLABS_API_KEY_REF: "elevenlabs_prod",
  TELNYX_ELEVENLABS_VOICE_ID: "abc123",
};

async function inbound(srv, { callSid }) {
  const res = await fetch(`${srv.localUrl}/voice/incoming`, {
    method: "POST",
    headers: TELNYX_HEADERS,
    body: new URLSearchParams({ CallSid: callSid, From: "+4915112345678", To: B_NUMBER }),
  });
  assert.equal(res.status, HTTP_OK);
  return res.text();
}

test("Selbstarmierung weg end-to-end: TELNYX_ELEVENLABS_*-Envs gesetzt, Telnyx-Inbound rendert TROTZDEM Azure", async () => {
  const srv = await startServer({ seed: seedWithB({ language: "de" }), env: EL_ENV });
  try {
    const telnyxXml = await inbound(srv, { callSid: "CAel1" });
    assert.match(
      telnyxXml,
      /voice="Azure\.de-DE-KatjaNeural"/,
      "Azure-Default unveraendert trotz gesetzter Envs",
    );
    assert.match(telnyxXml, /transcriptionEngine="Deepgram"/, "STT unveraendert Deepgram");
    assert.doesNotMatch(telnyxXml, /ElevenLabs/, "kein ElevenLabs-Attribut, kein Relay");
    assert.doesNotMatch(telnyxXml, /api_key_ref/, "kein api_key_ref am <Say>");
  } finally {
    await srv.stop();
  }
});

test("Ohne ElevenLabs-Env: Telnyx-Inbound bleibt byte-identisch auf dem Azure-Bestand", async () => {
  const srv = await startServer({ seed: seedWithB({ language: "de" }) });
  try {
    const xml = await inbound(srv, { callSid: "CAel3" });
    assert.match(xml, /voice="Azure\.de-DE-KatjaNeural"/, "Azure-Default unveraendert");
    assert.doesNotMatch(xml, /ElevenLabs/, "Gate aus -> kein ElevenLabs-Attribut");
  } finally {
    await srv.stop();
  }
});

const RECORD = process.env.IEL_GOLDEN_RECORD === "1";
const FIXTURE_PATH = fileURLToPath(
  new URL("../fixtures/iel-incoming-budget-golden.xml", import.meta.url),
);
const HTTP_OK = 200;
const GOLDEN_CALL_SID = "CAielgolden";
const GOLDEN_LANGUAGE = "de";
const INBOUND_PATH_BUDGET =
  /\[inbound-path\] inbound_path \{"callId":"call_[^"]+","path":"budget"\}/g;

async function renderIncoming(env) {
  const srv = await startServer({ env, seed: seedWithTelnyxNumber({ language: GOLDEN_LANGUAGE }) });
  try {
    const res = await postTelnyxIncoming(srv, { callSid: GOLDEN_CALL_SID });
    assert.equal(res.status, HTTP_OK);
    return { texml: normalizeIncomingTexml(await res.text()), stdout: srv.stdout };
  } finally {
    await srv.stop();
  }
}

function goldenFixture() {
  return fs.readFileSync(FIXTURE_PATH, "utf8");
}

test("IEL-B1-GOLDEN-1: Schalter aus, Default-Env - Inbound-TeXML byte-identisch zum Golden Master", async () => {
  const { texml } = await renderIncoming({});
  if (RECORD) {
    fs.writeFileSync(FIXTURE_PATH, `${texml}\n`);
    return;
  }
  assert.equal(`${texml}\n`, goldenFixture());
});

test("IEL-B1-GOLDEN-2: Schalter an, vollstaendiger Zugang, Tenant NICHT gepinnt - Budget-Pfad bleibt byte-identisch", async () => {
  const { texml, stdout } = await renderIncoming({
    ELEVENLABS_INBOUND_ENABLED: "true",
    ELEVENLABS_INBOUND_TENANT_IDS: "tenant_iel_nicht_gepinnt",
    ...EL_INBOUND_ACCESS_BOOT_ENV,
  });
  assert.equal(`${texml}\n`, goldenFixture());
  const inboundPathLines = stdout.match(INBOUND_PATH_BUDGET);
  assert.equal(inboundPathLines ? inboundPathLines.length : 0, 1, "genau eine Sonden-Zeile budget");
});
