import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

import { seedState, startServer } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { CONVERSATION_IN_PROGRESS } from "../fixtures/elevenlabs-conversations.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";
import { starteAttrappe } from "./attrappen-server.js";
import { makeTelnyxSigner, starteAttrappe as starteTelnyxAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const HTTP_OK = 200;
const HTTP_ABGELEHNT = 500;
const HTTP_NICHT_GESTARTET = 500;
const START_PFAD = "/v1/convai/sip-trunk/outbound-call";
const NACHGEHOLTE_KENNUNG = "phnum_nachgeholt_k";
const TTS_PFAD = "/v1/text-to-speech/";
const AUDIO_BYTES = 200_000;
const NUMMERN_PFAD = "/v1/convai/phone-numbers";

const GLOBALE_KENNUNG = "phnum_global_k";
const EIGENE_KENNUNG = "phnum_eigen_k";
const TENANT = "tenant-k";
const SUBJEKT = "sub-k";
const DEUTSCHE_NUMMER = "+4915005559321";
const ZIEL = "+4915005559400";
const ZIEL_TEXT = "Termin am Donnerstag vereinbaren (K-Test)";

const EL_UMGEBUNG = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_k",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: GLOBALE_KENNUNG,
  ELEVENLABS_API_KEY: "el-k-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "60000",
  MULTI_TENANT: "true",
  PROVISIONING_ENABLED: "true",
  ELEVENLABS_NUMBER_REGISTRATION_ENABLED: "true",
  TELNYX_SIP_TRUNK_USERNAME: "sip-user-k",
  TELNYX_SIP_TRUNK_PASSWORD: "sip-passwort-k",
});

const antworte = (res, status, nutzlast) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(nutzlast));
};

async function starteAnbieter(registrierungStatus = HTTP_ABGELEHNT) {
  const anfragen = [];
  const attrappe = await starteAttrappe((req, res) => {
    let roh = "";
    req.on("data", (stueck) => (roh += stueck));
    req.on("end", () => {
      const body = JSON.parse(roh || "{}");
      anfragen.push({ methode: req.method, pfad: req.url, body });
      if (req.url === NUMMERN_PFAD && req.method === "GET") return antworte(res, HTTP_OK, []);
      if (req.url === NUMMERN_PFAD) return antworte(res, registrierungStatus, { phone_number_id: NACHGEHOLTE_KENNUNG, detail: "abgelehnt" });
      if (req.url.startsWith(START_PFAD)) return antworte(res, HTTP_OK, { success: true, conversation_id: "conv_k_1" });
      if (req.url.startsWith(TTS_PFAD)) {
        res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
        return res.end(Buffer.alloc(AUDIO_BYTES, 1));
      }
      return antworte(res, HTTP_OK, { ...CONVERSATION_IN_PROGRESS, conversation_id: "conv_k_1" });
    });
  });
  return {
    url: attrappe.url,
    sipStarts: () => anfragen.filter((a) => a.methode === "POST" && a.pfad.startsWith(START_PFAD)),
    registrierungen: () => anfragen.filter((a) => a.methode === "POST" && a.pfad === NUMMERN_PFAD),
    kennungenAllerAnfragen: () => anfragen.map((a) => JSON.stringify(a.body)).join("\n"),
    schliessen: attrappe.close,
  };
}

function seedMitDeutscherNummer(eigeneKennung) {
  return seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      { id: TENANT, status: "active", idpSubject: SUBJEKT, ownerName: "Karin K", kycLevel: "card" },
    ],
    numbers: [
      {
        id: "num_k",
        e164: DEUTSCHE_NUMMER,
        tenantId: TENANT,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
        providerAgentPhoneNumberId: eigeneKennung,
      },
    ],
    profiles: { [TENANT]: { maxCallsPerHour: null } },
  });
}

let aufgeraeumt = [];

afterEach(async () => {
  for (const schliesse of aufgeraeumt) await schliesse();
  aufgeraeumt = [];
});

const alleAnfragen = ({ anbieter, telnyx }) => `${anbieter.kennungenAllerAnfragen()}\n${telnyx.rohkoerper.join("\n")}`;

async function rufeAn(eigeneKennung, { registrierungStatus, umgebung = {} } = {}) {
  const anbieter = await starteAnbieter(registrierungStatus);
  const telnyx = await starteTelnyxAttrappe();
  const srv = await startServer({
    env: {
      ...vorspannUmgebung({ attrappe: telnyx, signer: makeTelnyxSigner(), publicUrl: "https://agent.test", kennung: "k" }),
      ...vorspannMandantenUmgebung([TENANT]),
      ...EL_UMGEBUNG,
      ELEVENLABS_API_BASE: anbieter.url,
      ...umgebung,
    },
    seed: seedMitDeutscherNummer(eigeneKennung),
  });
  aufgeraeumt.push(() => srv.stop(), anbieter.schliessen, telnyx.close);
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Identity": SUBJEKT },
    body: JSON.stringify({ to: ZIEL, objective: ZIEL_TEXT }),
  });
  const call = srv.readStore().calls.find((eintrag) => eintrag.goal === ZIEL_TEXT);
  return { res, call, anbieter, telnyx };
}

test("K1: +49-Nummer mit eigener Registrierung startet mit genau der eigenen Kennung, die globale kommt nicht vor", async () => {
  const { res, call, anbieter, telnyx } = await rufeAn(EIGENE_KENNUNG);
  assert.equal(res.status, HTTP_OK, await res.text());
  assert.deepEqual(telnyx.waehlaufrufe.map((wahl) => wahl.from), [DEUTSCHE_NUMMER]);
  assert.equal(call.fromRegistrationSource, "tenant_did");
  assert.equal(call.from, DEUTSCHE_NUMMER);
  assert.ok(!alleAnfragen({ anbieter, telnyx }).includes(GLOBALE_KENNUNG), "globale Kennung in einer Anbieteranfrage");
});

test("K2: +49-Nummer ohne Registrierung wird nachgeholt, scheitert das, bricht der Anruf ab und die globale Kennung bleibt draussen", async () => {
  const { res, call, anbieter, telnyx } = await rufeAn(null);
  assert.equal(res.status, HTTP_NICHT_GESTARTET);
  assert.deepEqual(telnyx.waehlaufrufe, []);
  assert.deepEqual(anbieter.registrierungen().map((anfrage) => anfrage.body.phone_number), [DEUTSCHE_NUMMER]);
  assert.equal(call.status, "failed");
  assert.equal(call.fromRegistrationSource, "abgebrochen:keine_eigene_registrierung");
  assert.ok(!alleAnfragen({ anbieter, telnyx }).includes(GLOBALE_KENNUNG), "globale Kennung in einer Anbieteranfrage");
});

test("K3: wird die fehlende Registrierung nachgeholt, waehlt der Anruf ueber den Vorspann mit der eigenen DID als Absender", async () => {
  const { res, call, anbieter, telnyx } = await rufeAn(null, { registrierungStatus: HTTP_OK });
  assert.equal(res.status, HTTP_OK, await res.text());
  assert.deepEqual(anbieter.registrierungen().map((anfrage) => anfrage.body.phone_number), [DEUTSCHE_NUMMER]);
  assert.deepEqual(telnyx.waehlaufrufe.map((wahl) => wahl.from), [DEUTSCHE_NUMMER]);
  assert.deepEqual(anbieter.sipStarts(), []);
  assert.equal(call.fromRegistrationSource, "tenant_did");
  assert.ok(!alleAnfragen({ anbieter, telnyx }).includes(GLOBALE_KENNUNG), "globale Kennung in einer Anbieteranfrage");
});
