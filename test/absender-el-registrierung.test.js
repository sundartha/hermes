// OUTBOUND-E5 (F3): der ElevenLabs-Anrufstart ueber die ECHTE HTTP-Route (Muster
// test/elevenlabs-anrufstart.test.js) - Spawn-Server + lokale ElevenLabs-Attrappe, EIN
// echter POST /api/calls je Fall. Die Attrappe ZEICHNET den Anfragekoerper auf und die
// Tests PRUEFEN ihn (Blocker-Vermeidungsliste 3: eine Attrappe, die stur "ok" liefert,
// beweist nichts darueber, WELCHER Wert gesendet wurde).
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import {
  TELNYX_TEST_PEER_NUMBER,
  seedState,
  startServer,
} from "./helpers.js";
import { CONVERSATION_DONE_WITH_ANALYSIS } from "./fixtures/elevenlabs-conversations.js";

const HTTP_OK = 200;
const START_PATH = "/v1/convai/sip-trunk/outbound-call";
const CONVERSATION_PATH = "/v1/convai/conversations/";

const AGENT_ID = "agent_el_test_1";
// Der globale Rueckfall (ELEVENLABS_AGENT_PHONE_NUMBER_ID) - MUSS von jeder Tenant-
// eigenen Kennung unterscheidbar sein (B2 pinnt genau das).
const RUECKFALL_AGENT_PHONE_NUMBER_ID = "phnum_global_test";
const API_KEY = "el-api-key-testgeheim";
const RESULT_POLL_MS = "150";
const OBJECTIVE = "Termin am Donnerstag vereinbaren (E5-B-Test)";

const TENANT_A = "tenant-a";
const SUBJECT_A = "sub-a";
const NUMBER_A = "+4915005559002";
const REGISTRIERUNG_TENANT_A = "phnum_tenant_a";

const TENANT_B = "tenant-b";
const SUBJECT_B = "sub-b";
const NUMBER_B = "+4915005559003";

const EL_ENV = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: AGENT_ID,
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: RUECKFALL_AGENT_PHONE_NUMBER_ID,
  ELEVENLABS_API_KEY: API_KEY,
  ELEVENLABS_RESULT_POLL_MS: RESULT_POLL_MS,
  MULTI_TENANT: "true",
});

function endJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

// Attrappe mit GENAU den zwei Endpunkten, die dieser Weg braucht (Muster
// elevenlabs-anrufstart.test.js#startElevenLabsMock, hier schlanker: kein Abbruch-
// Schalter, diese Datei prueft den Absender, nicht die Fehlerpfade).
async function startElevenLabsMock() {
  const startRequests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (req.url.startsWith(START_PATH)) {
        startRequests.push({ body: JSON.parse(raw || "{}") });
        return endJson(res, HTTP_OK, { success: true, conversation_id: "conv_e5_test_1" });
      }
      if (req.url.startsWith(CONVERSATION_PATH))
        return endJson(res, HTTP_OK, CONVERSATION_DONE_WITH_ANALYSIS);
      return endJson(res, HTTP_OK, {});
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    startRequests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Tenant A (mit eigener EL-Registrierung) + Tenant B (ohne). BEIDE aktiv, verifiziert,
// mit Auftraggeber-Namen (passieren jedes Gate). Fehlende providerAgentPhoneNumberId bei
// Tenant B ist WEGGELASSEN (nicht null) - Muster der fail-closed-Praedikate im Bestand.
function seedZweiTenants() {
  return seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      { id: TENANT_A, status: "active", idpSubject: SUBJECT_A, ownerName: "Alice A", kycLevel: "card" },
      { id: TENANT_B, status: "active", idpSubject: SUBJECT_B, ownerName: "Bob B", kycLevel: "card" },
    ],
    numbers: [
      {
        id: "num_a",
        e164: NUMBER_A,
        tenantId: TENANT_A,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
        providerAgentPhoneNumberId: REGISTRIERUNG_TENANT_A,
      },
      {
        id: "num_b",
        e164: NUMBER_B,
        tenantId: TENANT_B,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
    ],
    profiles: { [TENANT_A]: { maxCallsPerHour: null }, [TENANT_B]: { maxCallsPerHour: null } },
  });
}

async function withElevenLabs(run) {
  const mock = await startElevenLabsMock();
  const srv = await startServer({
    env: { ...EL_ENV, ELEVENLABS_API_BASE: mock.url },
    seed: seedZweiTenants(),
  });
  try {
    return await run({ srv, mock });
  } finally {
    await srv.stop();
    await mock.close();
  }
}

function placeCall(srv, identity) {
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Identity": identity },
    body: JSON.stringify({ to: TELNYX_TEST_PEER_NUMBER, objective: OBJECTIVE }),
  });
}

const ownCall = (srv) => srv.readStore().calls.find((call) => call.goal === OBJECTIVE);

// B1: Tenant MIT eigener Registrierung ruft an -> der Anrufkoerper traegt GENAU ihre
// Kennung, byte-genau; to_number unveraendert.
test("B1: Tenant mit eigener Registrierung -> agent_phone_number_id ist ihre Kennung, byte-genau", async () => {
  await withElevenLabs(async ({ srv, mock }) => {
    const res = await placeCall(srv, SUBJECT_A);
    assert.equal(res.status, HTTP_OK, JSON.stringify(await res.json()));
    assert.equal(mock.startRequests.length, 1, "genau ein Anrufstart");
    const koerper = mock.startRequests[0].body;
    assert.equal(koerper.agent_phone_number_id, REGISTRIERUNG_TENANT_A);
    assert.equal(koerper.to_number, TELNYX_TEST_PEER_NUMBER);
  });
});

// B2: Tenant-Isolation UEBER DIE ROUTE - Tenant B (ohne eigene Registrierung) ruft an,
// WAEHREND Tenant A eine hat. Die fremde Kennung von Tenant A darf NIE geliefert werden.
test("B2: Tenant-Isolation ueber die Route - Tenant B faellt auf den Rueckfall, NIE auf Tenant As Kennung", async () => {
  await withElevenLabs(async ({ srv, mock }) => {
    const res = await placeCall(srv, SUBJECT_B);
    assert.equal(res.status, HTTP_OK, JSON.stringify(await res.json()));
    assert.equal(mock.startRequests.length, 1, "genau ein Anrufstart");
    const koerper = mock.startRequests[0].body;
    assert.equal(koerper.agent_phone_number_id, RUECKFALL_AGENT_PHONE_NUMBER_ID);
    assert.notEqual(koerper.agent_phone_number_id, REGISTRIERUNG_TENANT_A);
  });
});

// B3: der Rueckfall ist LAUT (E4-Lehre 4) - im Log benannt, Grund genannt, KEINE Rufnummer
// im Log.
test("B3: der Rueckfall ist LAUT im Log - benannt, mit Grund, ohne Rufnummer", async () => {
  await withElevenLabs(async ({ srv }) => {
    const res = await placeCall(srv, SUBJECT_B);
    assert.equal(res.status, HTTP_OK, JSON.stringify(await res.json()));
    assert.match(srv.stdout, /\[el-outbound\] Absender-Rueckfall/);
    assert.match(srv.stdout, /grund=keine_eigene_registrierung/);
    assert.ok(!srv.stdout.includes(NUMBER_B), "keine Rufnummer im Log");
  });
});

// B4: der Rueckfall ist am Anruf-Datensatz erkennbar.
test("B4: Rueckfall am Datensatz erkennbar - fromRegistrationSource=rueckfall_global", async () => {
  await withElevenLabs(async ({ srv }) => {
    const res = await placeCall(srv, SUBJECT_B);
    assert.equal(res.status, HTTP_OK, JSON.stringify(await res.json()));
    const call = ownCall(srv);
    assert.equal(call.fromRegistrationSource, "rueckfall_global");
  });
});

// B5: die eigene DID ist am Anruf-Datensatz erkennbar.
test("B5: eigene DID am Datensatz erkennbar - fromRegistrationSource=tenant_did", async () => {
  await withElevenLabs(async ({ srv }) => {
    const res = await placeCall(srv, SUBJECT_A);
    assert.equal(res.status, HTTP_OK, JSON.stringify(await res.json()));
    const call = ownCall(srv);
    assert.equal(call.fromRegistrationSource, "tenant_did");
  });
});

// B6: Bestandsschutz - call.from (= from_e164, die gebuchte Tenant-DID) ist in BEIDEN
// Faellen unveraendert die jeweilige Tenant-DID; der Routing-/Geo-/Tarifpfad haengt
// unveraendert an from_e164, nicht an der neuen Registrierungs-Herkunft.
test("B6: Bestandsschutz - call.from bleibt in BEIDEN Faellen die gebuchte Tenant-DID", async () => {
  await withElevenLabs(async ({ srv }) => {
    const resA = await placeCall(srv, SUBJECT_A);
    assert.equal(resA.status, HTTP_OK, JSON.stringify(await resA.json()));
    assert.equal(ownCall(srv).from, NUMBER_A);
  });
  await withElevenLabs(async ({ srv }) => {
    const resB = await placeCall(srv, SUBJECT_B);
    assert.equal(resB.status, HTTP_OK, JSON.stringify(await resB.json()));
    assert.equal(ownCall(srv).from, NUMBER_B);
  });
});
