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
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";
import { echtWarten } from "./echt-warten.js";

const HTTP_OK = 200;
const START_PATH = "/v1/convai/sip-trunk/outbound-call";
const CONVERSATION_PATH = "/v1/convai/conversations/";
const PHONE_NUMBERS_PATH = "/v1/convai/phone-numbers";
const NACHGEHOLTE_REGISTRIERUNG = "phnum_nachgeholt_b";
const HTTP_NOT_PLACED = 500;
const REGISTRIERUNG_DAUER_MS = 100;

const AGENT_ID = "agent_el_test_1";
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

async function startElevenLabsMock({ registrierungStatus = HTTP_OK } = {}) {
  const startRequests = [];
  const registrierungen = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (req.url === PHONE_NUMBERS_PATH) {
        if (req.method === "GET") return endJson(res, HTTP_OK, []);
        registrierungen.push(JSON.parse(raw || "{}"));
        return void echtWarten(REGISTRIERUNG_DAUER_MS).then(() =>
          endJson(res, registrierungStatus, { phone_number_id: NACHGEHOLTE_REGISTRIERUNG }),
        );
      }
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
    registrierungen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

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

const REGISTRIERUNG_NACHHOLEN_ENV = Object.freeze({
  PROVISIONING_ENABLED: "true",
  ELEVENLABS_NUMBER_REGISTRATION_ENABLED: "true",
  TELNYX_SIP_TRUNK_USERNAME: "sip-user-test",
  TELNYX_SIP_TRUNK_PASSWORD: "sip-passwort-test",
});

async function withElevenLabs(run, extraEnv = {}, optionen = {}) {
  const { seed = seedZweiTenants(), ...mockOptionen } = optionen;
  const mock = await startElevenLabsMock(mockOptionen);
  const srv = await startServer({
    env: { ...EL_ENV, ...extraEnv, ELEVENLABS_API_BASE: mock.url },
    seed,
  });
  try {
    return await run({ srv, mock });
  } finally {
    await srv.stop();
    await mock.close();
  }
}

function placeCall(srv, identity, to = TELNYX_TEST_PEER_NUMBER) {
  return abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Identity": identity },
    body: JSON.stringify({ to, objective: OBJECTIVE }),
  });
}

const ownCall = (srv) => srv.readStore().calls.find((call) => call.goal === OBJECTIVE);

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

test("B2: Tenant-Isolation ueber die Route - Tenant B ohne Registrierung startet NIE mit Tenant As Kennung und nicht mit der globalen", async () => {
  await withElevenLabs(async ({ srv, mock }) => {
    const res = await placeCall(srv, SUBJECT_B);
    assert.equal(res.status, HTTP_NOT_PLACED, "der Anruf wird klar abgelehnt");
    assert.equal(mock.startRequests.length, 0, "kein Anbieteraufruf, keine Kosten");
  });
});

test("B3: der Abbruch ist LAUT im Log - benannt, mit Grund, ohne Rufnummer", async () => {
  await withElevenLabs(async ({ srv }) => {
    await placeCall(srv, SUBJECT_B);
    assert.match(srv.stdout, /Anruf ohne eigene Absendernummer abgebrochen/);
    assert.match(srv.stdout, /grund=keine_eigene_registrierung/);
    assert.ok(!srv.stdout.includes(NUMBER_B), "keine Rufnummer im Log");
  });
});

test("B4: Abbruch am Datensatz erkennbar - failed und fromRegistrationSource=abgebrochen:<grund>", async () => {
  await withElevenLabs(async ({ srv }) => {
    await placeCall(srv, SUBJECT_B);
    const call = ownCall(srv);
    assert.equal(call.status, "failed");
    assert.equal(call.fromRegistrationSource, "abgebrochen:keine_eigene_registrierung");
  });
});

test("B5: eigene DID am Datensatz erkennbar - fromRegistrationSource=tenant_did", async () => {
  await withElevenLabs(async ({ srv }) => {
    const res = await placeCall(srv, SUBJECT_A);
    assert.equal(res.status, HTTP_OK, JSON.stringify(await res.json()));
    const call = ownCall(srv);
    assert.equal(call.fromRegistrationSource, "tenant_did");
  });
});

test("B6: Bestandsschutz - call.from bleibt in BEIDEN Faellen die gebuchte Tenant-DID", async () => {
  await withElevenLabs(async ({ srv }) => {
    const resA = await placeCall(srv, SUBJECT_A);
    assert.equal(resA.status, HTTP_OK, JSON.stringify(await resA.json()));
    assert.equal(ownCall(srv).from, NUMBER_A);
  });
  await withElevenLabs(async ({ srv }) => {
    await placeCall(srv, SUBJECT_B);
    assert.equal(ownCall(srv).from, NUMBER_B);
  });
});

test("ANR: Tenant mit aktiver DID ohne eigene Registrierung -> KEIN Anrufstart mit der globalen Kennung", async () => {
  await withElevenLabs(async ({ srv, mock }) => {
    await placeCall(srv, SUBJECT_B);
    const mitGlobalerKennung = mock.startRequests.filter(
      (anfrage) => anfrage.body.agent_phone_number_id === RUECKFALL_AGENT_PHONE_NUMBER_ID,
    );
    assert.equal(mitGlobalerKennung.length, 0, "der Angerufene sah die globale Ersatznummer statt der des Abonnenten");
  });
});

test("ANR: fehlende Registrierung wird zur Anrufzeit nachgeholt - der Anruf startet mit der Kennung der eigenen DID", async () => {
  await withElevenLabs(async ({ srv, mock }) => {
    const res = await placeCall(srv, SUBJECT_B);
    assert.equal(res.status, HTTP_OK, JSON.stringify(await res.json()));
    assert.equal(mock.registrierungen.length, 1, "genau eine Registrierung angelegt");
    assert.equal(mock.registrierungen[0].phone_number, NUMBER_B);
    assert.equal(mock.startRequests.length, 1);
    const [start] = mock.startRequests;
    assert.equal(start.body.agent_phone_number_id, NACHGEHOLTE_REGISTRIERUNG);
    assert.equal(ownCall(srv).fromRegistrationSource, "tenant_did");
    const nummer = srv.readStore().numbers.find((number) => number.e164 === NUMBER_B);
    assert.equal(nummer.providerAgentPhoneNumberId, NACHGEHOLTE_REGISTRIERUNG, "Kennung dauerhaft gespeichert");
  }, REGISTRIERUNG_NACHHOLEN_ENV);
});

test("ANR: Boot meldet woertlich, ob die Nummernregistrierung eingehaengt ist", async () => {
  await withElevenLabs(async ({ srv }) => {
    assert.match(srv.stdout, /\[boot\] Konfig-Warnung: ElevenLabs-Nummernregistrierung NICHT eingehaengt/);
  });
  await withElevenLabs(async ({ srv }) => {
    assert.match(srv.stdout, /\[boot\] ElevenLabs-Nummernregistrierung: eingehaengt/);
  }, REGISTRIERUNG_NACHHOLEN_ENV);
  await withElevenLabs(
    async ({ srv }) => {
      assert.match(
        srv.stdout,
        /Konfig-Warnung: ELEVENLABS_NUMBER_REGISTRATION_ENABLED=true ohne TELNYX_SIP_TRUNK_USERNAME/,
      );
      assert.doesNotMatch(srv.stdout, /\[boot\] ElevenLabs-Nummernregistrierung: eingehaengt/);
    },
    { ...REGISTRIERUNG_NACHHOLEN_ENV, TELNYX_SIP_TRUNK_USERNAME: "", TELNYX_SIP_TRUNK_PASSWORD: "" },
  );
});

const ZWEITES_ZIEL = "+4915005559100";
const REGISTRIERUNG_ABGELEHNT = 500;

test("ANR: zwei gleichzeitige Anrufe derselben DID legen genau eine Registrierung an", async () => {
  await withElevenLabs(
    async ({ srv, mock }) => {
      const antworten = await Promise.all([
        placeCall(srv, SUBJECT_B),
        placeCall(srv, SUBJECT_B, ZWEITES_ZIEL),
      ]);
      assert.deepEqual(antworten.map((antwort) => antwort.status), [HTTP_OK, HTTP_OK]);
      assert.equal(mock.registrierungen.length, 1, "ein geteilter Versuch, nicht zwei Registrierungen");
      assert.equal(mock.startRequests.length, 2);
    },
    REGISTRIERUNG_NACHHOLEN_ENV,
  );
});

test("ANR: scheitert das Nachholen, endet der Anruf ohne Anbieteraufruf und mit dem Grund im Datensatz", async () => {
  await withElevenLabs(
    async ({ srv, mock }) => {
      const res = await placeCall(srv, SUBJECT_B);
      assert.equal(res.status, HTTP_NOT_PLACED);
      assert.equal(mock.registrierungen.length, 1, "der Versuch fand statt");
      assert.equal(mock.startRequests.length, 0, "kein Anrufstart beim Anbieter");
      const call = ownCall(srv);
      assert.equal(call.status, "failed");
      assert.equal(call.fromRegistrationSource, "abgebrochen:keine_eigene_registrierung");
    },
    REGISTRIERUNG_NACHHOLEN_ENV,
    { registrierungStatus: REGISTRIERUNG_ABGELEHNT },
  );
});

function stdoutZeile(srv, muster) {
  return srv.stdout.split("\n").find((zeile) => muster.test(zeile));
}

test("ANR: Boot nennt bei nicht eingehaengter Registrierung die drei Schalter und die Folge fuer ausgehende Anrufe", async () => {
  await withElevenLabs(async ({ srv }) => {
    const zeile = stdoutZeile(srv, /ElevenLabs-Nummernregistrierung NICHT eingehaengt/);
    assert.ok(zeile, "keine Boot-Warnung");
    for (const schalter of ["ELEVENLABS_OUTBOUND_ENABLED", "PROVISIONING_ENABLED", "ELEVENLABS_NUMBER_REGISTRATION_ENABLED"]) {
      assert.ok(zeile.includes(schalter), `${schalter} fehlt in der Warnung`);
    }
    assert.match(zeile, /ausgehende Anrufe von DIDs ohne Registrierung brechen ab/);
  });
});

test("ANR: Boot meldet NICHT eingehaengt und nie zugleich eingehaengt, auch wenn die Zugangsdaten gesetzt sind", async () => {
  await withElevenLabs(
    async ({ srv }) => {
      assert.match(srv.stdout, /ElevenLabs-Nummernregistrierung NICHT eingehaengt/);
      assert.doesNotMatch(srv.stdout, /\[boot\] ElevenLabs-Nummernregistrierung: eingehaengt/);
    },
    { ...REGISTRIERUNG_NACHHOLEN_ENV, ELEVENLABS_NUMBER_REGISTRATION_ENABLED: "false" },
  );
});

test("ANR: Boot meldet eingehaengt nur mit Benutzer UND Passwort des SIP-Zugangs", async () => {
  for (const fehlend of ["TELNYX_SIP_TRUNK_USERNAME", "TELNYX_SIP_TRUNK_PASSWORD"]) {
    await withElevenLabs(
      async ({ srv }) => {
        assert.doesNotMatch(srv.stdout, /\[boot\] ElevenLabs-Nummernregistrierung: eingehaengt/, fehlend);
        const zeile = stdoutZeile(srv, /ELEVENLABS_NUMBER_REGISTRATION_ENABLED=true ohne/);
        assert.ok(zeile, `${fehlend}: keine Warnung zum fehlenden Zugang`);
        assert.match(zeile, /ausgehende Anrufe von DIDs ohne Registrierung brechen ab/);
      },
      { ...REGISTRIERUNG_NACHHOLEN_ENV, [fehlend]: "" },
    );
  }
});

test("ANR: Boot sagt nichts zur Nummernregistrierung, solange ElevenLabs-Outbound aus ist", async () => {
  const srv = await startServer({ seed: seedZweiTenants() });
  try {
    assert.doesNotMatch(srv.stdout, /ElevenLabs-Nummernregistrierung/);
  } finally {
    await srv.stop();
  }
});

test("ANR: scheitert das Nachholen, steht die Nummer und der Grund in einer benannten Log-Zeile", async () => {
  await withElevenLabs(
    async ({ srv }) => {
      await placeCall(srv, SUBJECT_B);
      assert.match(srv.stdout, /\[el-outbound\] Registrierung nachholen FEHLGESCHLAGEN number=num_b: \S/);
      assert.ok(!srv.stdout.includes(REGISTRIERUNG_NACHHOLEN_ENV.TELNYX_SIP_TRUNK_PASSWORD), "Passwort im Log");
    },
    REGISTRIERUNG_NACHHOLEN_ENV,
    { registrierungStatus: REGISTRIERUNG_ABGELEHNT },
  );
});

test("ANR: ohne eingehaengte Registrierung wird nichts nachgeholt und der Abbruch nennt den Grund", async () => {
  await withElevenLabs(async ({ srv, mock }) => {
    await placeCall(srv, SUBJECT_B);
    assert.equal(mock.registrierungen.length, 0);
    assert.doesNotMatch(srv.stdout, /Registrierung nachholen/);
    assert.match(srv.stdout, /grund=keine_eigene_registrierung \(Nummernregistrierung nicht eingehaengt/);
  });
});

test("ANR: zwei gleichzeitige Anrufe verschiedener DIDs holen je ihre eigene Registrierung nach", async () => {
  const ohneRegistrierung = seedZweiTenants();
  ohneRegistrierung.numbers = ohneRegistrierung.numbers.map((nummer) => ({
    ...nummer,
    providerAgentPhoneNumberId: undefined,
  }));
  await withElevenLabs(
    async ({ srv, mock }) => {
      const antworten = await Promise.all([placeCall(srv, SUBJECT_A), placeCall(srv, SUBJECT_B, ZWEITES_ZIEL)]);
      assert.deepEqual(antworten.map((antwort) => antwort.status), [HTTP_OK, HTTP_OK]);
      assert.deepEqual(mock.registrierungen.map((anfrage) => anfrage.phone_number).sort(), [NUMBER_A, NUMBER_B]);
      assert.equal(mock.startRequests.length, 2);
      const { numbers } = srv.readStore();
      const gespeichert = numbers
        .filter((nummer) => [NUMBER_A, NUMBER_B].includes(nummer.e164))
        .map((nummer) => nummer.providerAgentPhoneNumberId);
      assert.deepEqual(gespeichert, [NACHGEHOLTE_REGISTRIERUNG, NACHGEHOLTE_REGISTRIERUNG]);
    },
    REGISTRIERUNG_NACHHOLEN_ENV,
    { seed: ohneRegistrierung },
  );
});

function abbruchZeile(srv) {
  return stdoutZeile(srv, /Anruf ohne eigene Absendernummer abgebrochen/);
}

test("ANR: mit eingehaengter Registrierung nennt der Abbruch den Grund ohne den Hinweis auf fehlende Einhaengung", async () => {
  await withElevenLabs(
    async ({ srv }) => {
      await placeCall(srv, SUBJECT_B);
      const zeile = abbruchZeile(srv);
      assert.ok(zeile, "keine Abbruch-Zeile");
      assert.match(zeile, /grund=keine_eigene_registrierung$/);
    },
    REGISTRIERUNG_NACHHOLEN_ENV,
    { registrierungStatus: REGISTRIERUNG_ABGELEHNT },
  );
});

test("ANR: eine DID mit eigener Registrierung wird bei eingehaengter Registrierung nicht erneut registriert", async () => {
  await withElevenLabs(async ({ srv, mock }) => {
    const res = await placeCall(srv, SUBJECT_A);
    assert.equal(res.status, HTTP_OK, JSON.stringify(await res.json()));
    assert.deepEqual(mock.registrierungen, []);
    const [start] = mock.startRequests;
    assert.equal(start.body.agent_phone_number_id, REGISTRIERUNG_TENANT_A);
    assert.doesNotMatch(srv.stdout, /Registrierung nachholen/);
  }, REGISTRIERUNG_NACHHOLEN_ENV);
});
