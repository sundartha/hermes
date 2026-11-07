import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

import { seedState, startServer } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { CONVERSATION_IN_PROGRESS } from "../fixtures/elevenlabs-conversations.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteAttrappe } from "./attrappen-server.js";

const HTTP_OK = 200;
const HTTP_ABGELEHNT = 500;
const HTTP_NICHT_GESTARTET = 500;
const START_PFAD = "/v1/convai/sip-trunk/outbound-call";
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

async function starteAnbieter() {
  const anfragen = [];
  const attrappe = await starteAttrappe((req, res) => {
    let roh = "";
    req.on("data", (stueck) => (roh += stueck));
    req.on("end", () => {
      const body = JSON.parse(roh || "{}");
      anfragen.push({ methode: req.method, pfad: req.url, body });
      if (req.url === NUMMERN_PFAD && req.method === "GET") return antworte(res, HTTP_OK, []);
      if (req.url === NUMMERN_PFAD) return antworte(res, HTTP_ABGELEHNT, { detail: "abgelehnt" });
      if (req.url.startsWith(START_PFAD)) return antworte(res, HTTP_OK, { success: true, conversation_id: "conv_k_1" });
      return antworte(res, HTTP_OK, { ...CONVERSATION_IN_PROGRESS, conversation_id: "conv_k_1" });
    });
  });
  return {
    url: attrappe.url,
    starts: () => anfragen.filter((a) => a.methode === "POST" && a.pfad.startsWith(START_PFAD)),
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

async function rufeAn(eigeneKennung) {
  const anbieter = await starteAnbieter();
  const srv = await startServer({
    env: { ...EL_UMGEBUNG, ELEVENLABS_API_BASE: anbieter.url },
    seed: seedMitDeutscherNummer(eigeneKennung),
  });
  aufgeraeumt.push(() => srv.stop(), anbieter.schliessen);
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Identity": SUBJEKT },
    body: JSON.stringify({ to: ZIEL, objective: ZIEL_TEXT }),
  });
  const call = srv.readStore().calls.find((eintrag) => eintrag.goal === ZIEL_TEXT);
  return { res, call, anbieter };
}

test("K1: +49-Nummer mit eigener Registrierung startet mit genau der eigenen Kennung, die globale kommt nicht vor", async () => {
  const { res, call, anbieter } = await rufeAn(EIGENE_KENNUNG);
  assert.equal(res.status, HTTP_OK, await res.text());
  assert.deepEqual(anbieter.starts().map((start) => start.body.agent_phone_number_id), [EIGENE_KENNUNG]);
  assert.equal(call.fromRegistrationSource, "tenant_did");
  assert.equal(call.from, DEUTSCHE_NUMMER);
  assert.ok(!anbieter.kennungenAllerAnfragen().includes(GLOBALE_KENNUNG), "globale Kennung in einer Anbieteranfrage");
});

test("K2: +49-Nummer ohne Registrierung wird nachgeholt, scheitert das, bricht der Anruf ab und die globale Kennung bleibt draussen", async () => {
  const { res, call, anbieter } = await rufeAn(null);
  assert.equal(res.status, HTTP_NICHT_GESTARTET);
  assert.deepEqual(anbieter.starts(), []);
  assert.equal(call.status, "failed");
  assert.equal(call.fromRegistrationSource, "abgebrochen:keine_eigene_registrierung");
  assert.ok(!anbieter.kennungenAllerAnfragen().includes(GLOBALE_KENNUNG), "globale Kennung in einer Anbieteranfrage");
});
