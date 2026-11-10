import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import {
  OWNER_TEST_FIRST_NAME,
  makeTelnyxSigner,
  nowSeconds,
  seedCall,
  seedState,
  startServer,
  waitUntil as wartebis,
} from "../helpers.js";
import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const WARTE_FRIST_MS = 5_000;
const AUDIO_BYTES = 200_000;
const NUMMER_PRAEFIX = "+4915112377";
const EINMAL = 1;
const NUMMER_STELLEN = 3;
const PUBLIC_URL = "https://agent.test";
const STORE_DATEI = "store.json";

const waitUntil = (bedingung) => wartebis(bedingung, { timeoutMs: WARTE_FRIST_MS });
const calleeVon = (callId) => `cc_callee_${callId}`;
const elVon = (callId) => `cc_el_${callId}`;

async function starteAttrappe(vorElAntwort) {
  const pfade = [];
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", async () => {
      pfade.push(req.url);
      if (req.url.startsWith("/v1/text-to-speech/")) {
        res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
        return res.end(Buffer.alloc(AUDIO_BYTES, 1));
      }
      const befehl = req.url === "/v2/calls" ? JSON.parse(roh).command_id : "";
      const istEl = befehl.endsWith("-el");
      if (istEl) await vorElAntwort();
      const callId = befehl.replace(/^vorspann-/, "").replace(/-el$/, "");
      const kennung = istEl ? elVon(callId) : calleeVon(callId);
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { call_control_id: kennung, result: "ok" } }));
    });
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  return {
    pfade,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((fertig) => server.close(fertig));
    },
  };
}

const umgebung = { vorElAntwort: async () => {}, zaehler: 0 };

before(async () => {
  umgebung.attrappe = await starteAttrappe(() => umgebung.vorElAntwort());
  umgebung.signer = makeTelnyxSigner();
  umgebung.env = {
      ...elInboundInitSpawnEnv("agent_3553_json"),
      ELEVENLABS_OUTBOUND_ENABLED: "true",
      ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
      ELEVENLABS_OUTBOUND_VORSPANN: "true",
      TELNYX_CALL_CONTROL_APP_ID: "cc_app_3553",
      ELEVENLABS_API_KEY: "test-key-3553",
      ELEVENLABS_API_BASE: umgebung.attrappe.url,
      ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_3553",
      ELEVENLABS_RESULT_POLL_MS: "60000",
      TELNYX_API_BASE: umgebung.attrappe.url,
      TELNYX_API_KEY: "KEYtest-3553",
      TELNYX_CONNECTION_ID: "conn_3553",
      TELNYX_ACCOUNT_SID: "acct_3553",
      SKIP_TWILIO_SIGNATURE_CHECK: "false",
      TELNYX_PUBLIC_KEY: umgebung.signer.publicKeyBase64,
      PUBLIC_URL,
  };
  umgebung.srv = await startServer({
    env: umgebung.env,
    seed: seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] }),
  });
});

after(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

const anrufIn = (id) => {
  const { calls } = umgebung.srv.readStore();
  return calls.find((eintrag) => eintrag.id === id);
};

async function neuerAnruf() {
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: `${NUMMER_PRAEFIX}${String((umgebung.zaehler += EINMAL)).padStart(NUMMER_STELLEN, "0")}`, objective: "Termin am Donnerstag vereinbaren" }),
  });
  return (await antwort.json()).callId;
}

function hebeAb(callId) {
  const roh = JSON.stringify({ data: { id: `evt-3553-${callId}`, event_type: "call.answered", payload: { call_control_id: calleeVon(callId) } } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}

test("3553-K1: die Kennung des EL-Beins steht nach der Wahl in der Ablage", async () => {
  const callId = await neuerAnruf();
  assert.equal(anrufIn(callId).elCallControlId ?? null, null);
  assert.equal((await hebeAb(callId)).status, HTTP_OK);
  await waitUntil(() => anrufIn(callId).elCallControlId === elVon(callId));
});

test("3553-K1: scheitert das Speichern, laeuft der Anruf weiter und der Fehler steht nur im Log", async () => {
  const { srv } = umgebung;
  const datei = path.join(srv.dataDir, STORE_DATEI);
  const sicherung = `${datei}.sicherung`;
  umgebung.vorElAntwort = async () => {
    fs.renameSync(datei, sicherung);
    fs.mkdirSync(datei);
  };
  const callId = await neuerAnruf();
  assert.ok(callId);
  try {
    assert.equal((await hebeAb(callId)).status, HTTP_OK);
    await waitUntil(() => srv.stdout.includes(`[el-vorspann] el-bein-speichern fehlgeschlagen call=${callId}:`));
  } finally {
    umgebung.vorElAntwort = async () => {};
    fs.rmSync(datei, { recursive: true, force: true });
    fs.renameSync(sicherung, datei);
  }
  assert.ok(!srv.stdout.includes(`el-wahl fehlgeschlagen call=${callId}`), srv.stdout);
  assert.ok(!srv.stdout.includes(`abheben fehlgeschlagen call=${callId}`), srv.stdout);
});

test("3553-K2: nach einem Neustart kennt Hermes das EL-Bein und legt beim Abbrechen beide Beine auf", async () => {
  const callId = await neuerAnruf();
  assert.equal((await hebeAb(callId)).status, HTTP_OK);
  await waitUntil(() => anrufIn(callId).elCallControlId === elVon(callId));
  await umgebung.srv.stop();
  umgebung.srv = await startServer({ env: umgebung.env, dataDir: umgebung.srv.dataDir });
  assert.equal(anrufIn(callId).elCallControlId, elVon(callId));
  const { pfade } = umgebung.attrappe;
  const vorher = pfade.length;
  const beendet = await abrufMitFrist(`${umgebung.srv.localUrl}/api/calls/${callId}/cancel`, { method: "POST" });
  assert.equal(beendet.status, HTTP_OK);
  const aufgelegt = () => pfade.slice(vorher).filter((pfad) => pfad.endsWith("/actions/hangup")).sort();
  await waitUntil(() => aufgelegt().length >= 2);
  assert.deepEqual(aufgelegt(), [`/v2/calls/${calleeVon(callId)}/actions/hangup`, `/v2/calls/${elVon(callId)}/actions/hangup`]);
});
