import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import { OWNER_TEST_FIRST_NAME, seedCall, seedState, startServer, waitUntil } from "../helpers.js";
import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const HTTP_CONFLICT = 409;
const AUDIO_BYTES = 200_000;
const EIGENE_NUMMER = "+12025550177";
const ZIEL = "+4915112484799";
const AGENT_ID = "agent_4819_h3";
const FRIST_MS = 5_000;
const REGISTRIERUNG = "phnum_4819_h3";
const NACHGEHOLT = "phnum_nachgeholt_4819";
const NUMMERN_PFAD = "/v1/convai/phone-numbers";
const WAHL_PFAD = "/v2/calls";

async function starteAttrappe() {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", () => {
      anfragen.push({ methode: req.method, pfad: req.url });
      if (req.url.startsWith("/v1/text-to-speech/")) {
        res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
        return res.end(Buffer.alloc(AUDIO_BYTES, 1));
      }
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      if (req.url === NUMMERN_PFAD) return res.end(JSON.stringify(req.method === "GET" ? [] : { phone_number_id: NACHGEHOLT }));
      const kennung = roh.startsWith("{") ? JSON.parse(roh).command_id : "x";
      res.end(JSON.stringify({ data: { call_control_id: `cc_${kennung}`, sid: "v3:ob-4819", result: "ok" } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    anfragen,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

async function anrufMitNummer(registrierung) {
  const attrappe = await starteAttrappe();
  const srv = await startServer({
    env: {
      ...elInboundInitSpawnEnv(AGENT_ID),
      TELNYX_CALL_CONTROL_APP_ID: "cc_app_4819_h3",
      ELEVENLABS_API_KEY: "test-key-4819",
      ELEVENLABS_API_BASE: attrappe.url,
      ELEVENLABS_RESULT_POLL_MS: "60000",
      TELNYX_API_BASE: attrappe.url,
      TELNYX_API_KEY: "KEYtest-4819",
      TELNYX_CONNECTION_ID: "conn_4819",
      TELNYX_ACCOUNT_SID: "acct_4819",
      PUBLIC_URL: "https://agent.test",
      PROVISIONING_ENABLED: "true",
      ELEVENLABS_NUMBER_REGISTRATION_ENABLED: "true",
      TELNYX_SIP_TRUNK_USERNAME: "sip-user-4819",
      TELNYX_SIP_TRUNK_PASSWORD: "sip-passwort-4819",
    },
    seed: seedState({
      tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }],
      numbers: [
        {
          id: "num_4819",
          e164: EIGENE_NUMMER,
          tenantId: TENANT_ID,
          provider: "telnyx",
          status: "active",
          providerNumberId: null,
          providerAgentPhoneNumberId: registrierung,
        },
      ],
    }),
  });
  try {
    const antwort = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: ZIEL, objective: "Termin am Donnerstag vereinbaren" }),
    });
    const koerper = await antwort.json();
    if (antwort.status !== HTTP_OK)
      await waitUntil(() => srv.readStore().calls.some((eintrag) => eintrag.to === ZIEL && eintrag.status === "failed"), {
        timeoutMs: FRIST_MS,
      });
    const anruf = srv.readStore().calls.find((eintrag) => eintrag.to === ZIEL);
    return { status: antwort.status, koerper, anruf, anfragen: attrappe.anfragen, stdout: srv.stdout };
  } finally {
    await srv.stop();
    await attrappe.close();
  }
}

const wahlen = (anfragen) => anfragen.filter((anfrage) => anfrage.pfad === WAHL_PFAD);
const registrierungsversuche = (anfragen) =>
  anfragen.filter((anfrage) => anfrage.pfad === NUMMERN_PFAD && anfrage.methode === "POST");

test("ausgang-nur-eigene-registrierung: Nummer ohne Registrierung bricht vor dem Anbieter ab und legt zur Anrufzeit nichts an", async () => {
  const ergebnis = await anrufMitNummer(null);
  assert.equal(ergebnis.status, HTTP_CONFLICT);
  assert.equal(ergebnis.koerper.grund, "keine_eigene_registrierung");
  assert.equal(wahlen(ergebnis.anfragen).length, 0);
  assert.equal(registrierungsversuche(ergebnis.anfragen).length, 0);
  assert.equal(ergebnis.anruf.status, "failed");
  assert.equal(ergebnis.anruf.failureReason, "not-placed:keine_eigene_registrierung");
  assert.equal(ergebnis.anruf.from, EIGENE_NUMMER);
  assert.match(ergebnis.stdout, /^\[el-outbound-weg\] weg=abbruch grund=keine_eigene_registrierung call=/m);
});

test("ausgang-nur-eigene-registrierung: Nummer mit Registrierung waehlt ueber den Vorspann von der eigenen Nummer", async () => {
  const ergebnis = await anrufMitNummer(REGISTRIERUNG);
  assert.equal(ergebnis.status, HTTP_OK);
  assert.equal(wahlen(ergebnis.anfragen).length, 1);
  assert.equal(registrierungsversuche(ergebnis.anfragen).length, 0);
  assert.equal(ergebnis.anruf.from, EIGENE_NUMMER);
  assert.match(ergebnis.stdout, /^\[el-outbound-weg\] weg=telnyx_vorspann call=/m);
});
