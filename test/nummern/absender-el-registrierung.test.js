import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import {
  TELNYX_TEST_PEER_NUMBER,
  seedState,
  startServer,
  waitForLog,
} from "../helpers.js";
import { CONVERSATION_DONE_WITH_ANALYSIS } from "../fixtures/elevenlabs-conversations.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";
import { makeTelnyxSigner, starteAttrappe, vorspannUmgebung } from "../anrufe/el-bein-attrappe.js";

const HTTP_OK = 200;
const TTS_PATH = "/v1/text-to-speech/";
const AUDIO_BYTES = 200_000;
const CONVERSATION_PATH = "/v1/convai/conversations/";
const PHONE_NUMBERS_PATH = "/v1/convai/phone-numbers";
const NACHGEHOLTE_REGISTRIERUNG = "phnum_nachgeholt_b";
const HTTP_CONFLICT = 409;

const AGENT_ID = "agent_el_test_1";
const RUECKFALL_AGENT_PHONE_NUMBER_ID = "phnum_global_test";
const API_KEY = "el-api-key-testgeheim";
const RESULT_POLL_MS = "150";
const OBJECTIVE = "Termin am Donnerstag vereinbaren (E5-B-Test)";

const TENANT_A = "tenant-a";
const SUBJECT_A = "sub-a";
const NUMBER_A = "+12025550142";
const PRIVATNUMMER_A = "+4915005559800";
const REGISTRIERUNG_TENANT_A = "phnum_tenant_a";

const TENANT_B = "tenant-b";
const SUBJECT_B = "sub-b";
const NUMBER_B = "+12025550143";

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

async function startElevenLabsMock({
  registrierungStatus = HTTP_OK,
  conversation = CONVERSATION_DONE_WITH_ANALYSIS,
} = {}) {
  const registrierungen = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (req.url === PHONE_NUMBERS_PATH) {
        if (req.method === "GET") return endJson(res, HTTP_OK, []);
        registrierungen.push(JSON.parse(raw || "{}"));
        return void new Promise((fertig) => setImmediate(fertig)).then(() =>
          endJson(res, registrierungStatus, { phone_number_id: NACHGEHOLTE_REGISTRIERUNG }),
        );
      }
      if (req.url.startsWith(TTS_PATH)) {
        res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
        return res.end(Buffer.alloc(AUDIO_BYTES, 1));
      }
      if (req.url.startsWith(CONVERSATION_PATH))
        return endJson(res, HTTP_OK, conversation);
      return endJson(res, HTTP_OK, {});
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    registrierungen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function seedZweiTenants() {
  return seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      { id: TENANT_A, status: "active", idpSubject: SUBJECT_A, ownerName: "Alice A", kycLevel: "card", privateNumber: PRIVATNUMMER_A },
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

async function withVorspann(run, extraEnv = {}, { wahlAblehnung = null, seed = seedZweiTenants(), ...mockOptionen } = {}) {
  const mock = await startElevenLabsMock(mockOptionen);
  const telnyx = await starteAttrappe(undefined, wahlAblehnung);
  const srv = await startServer({
    env: {
      ...vorspannUmgebung({ attrappe: telnyx, signer: makeTelnyxSigner(), publicUrl: "https://agent.test", kennung: "b" }),
      ...vorspannMandantenUmgebung([TENANT_A, TENANT_B]),
      ...EL_ENV,
      ...extraEnv,
      ELEVENLABS_API_BASE: mock.url,
    },
    seed,
  });
  try {
    return await run({ srv, mock, telnyx });
  } finally {
    await srv.stop();
    await mock.close();
    await telnyx.close();
  }
}

const KENNUNGEN = [RUECKFALL_AGENT_PHONE_NUMBER_ID, REGISTRIERUNG_TENANT_A];
const kennungenInAnfragen = ({ telnyx }) => KENNUNGEN.filter((kennung) => telnyx.rohkoerper.join("\n").includes(kennung));

function placeCall(srv, identity, to = TELNYX_TEST_PEER_NUMBER) {
  return abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Identity": identity },
    body: JSON.stringify({ to, objective: OBJECTIVE }),
  });
}

const ownCall = (srv) => srv.readStore().calls.find((call) => call.goal === OBJECTIVE);

test("B1: Tenant mit eigener Registrierung -> die Wahl geht von der eigenen DID aus, byte-genau", async () => {
  await withVorspann(async ({ srv, telnyx }) => {
    const res = await placeCall(srv, SUBJECT_A);
    assert.equal(res.status, HTTP_OK, JSON.stringify(await res.json()));
    assert.equal(telnyx.waehlaufrufe.length, 1, "genau eine Wahl");
    const wahl = telnyx.waehlaufrufe[0];
    assert.equal(wahl.from, NUMBER_A);
    assert.equal(wahl.to, TELNYX_TEST_PEER_NUMBER);
    assert.deepEqual(kennungenInAnfragen({ telnyx }), []);
  });
});

test("B2: Tenant-Isolation ueber die Route - Tenant B ohne Registrierung waehlt NIE von Tenant As DID und nicht mit der globalen", async () => {
  await withVorspann(async ({ srv, telnyx }) => {
    const res = await placeCall(srv, SUBJECT_B);
    assert.equal(res.status, HTTP_CONFLICT, "der Anruf wird klar abgelehnt");
    assert.equal(telnyx.waehlaufrufe.length, 0, "kein Anbieteraufruf, keine Kosten");
    assert.deepEqual(kennungenInAnfragen({ telnyx }), []);
    assert.ok(!telnyx.rohkoerper.join("\n").includes(NUMBER_A), "Tenant As DID in einer Anbieteranfrage");
  });
});

test("B3: der Abbruch ist LAUT im Log - benannt, mit Grund, ohne Rufnummer", async () => {
  await withVorspann(async ({ srv }) => {
    await placeCall(srv, SUBJECT_B);
    assert.match(srv.stdout, /\[el-outbound-weg\] weg=abbruch grund=keine_eigene_registrierung call=/);
    assert.ok(!srv.stdout.includes(NUMBER_B), "keine Rufnummer im Log");
  });
});

test("B4: Abbruch am Datensatz erkennbar - failed und failureReason=not-placed:<grund>", async () => {
  await withVorspann(async ({ srv }) => {
    await placeCall(srv, SUBJECT_B);
    const call = ownCall(srv);
    assert.equal(call.status, "failed");
    assert.equal(call.failureReason, "not-placed:keine_eigene_registrierung");
  });
});

test("B6: Bestandsschutz - call.from bleibt in BEIDEN Faellen die gebuchte Tenant-DID", async () => {
  await withVorspann(async ({ srv }) => {
    const resA = await placeCall(srv, SUBJECT_A);
    assert.equal(resA.status, HTTP_OK, JSON.stringify(await resA.json()));
    assert.equal(ownCall(srv).from, NUMBER_A);
  });
  await withVorspann(async ({ srv }) => {
    await placeCall(srv, SUBJECT_B);
    assert.equal(ownCall(srv).from, NUMBER_B);
  });
});

test("ANR: Tenant mit aktiver DID ohne eigene Registrierung -> KEIN Anrufstart mit der globalen Kennung", async () => {
  await withVorspann(async ({ srv, telnyx }) => {
    await placeCall(srv, SUBJECT_B);
    const mitGlobalerKennung = telnyx.rohkoerper.filter((roh) => roh.includes(RUECKFALL_AGENT_PHONE_NUMBER_ID));
    assert.equal(mitGlobalerKennung.length, 0, "der Angerufene sah die globale Ersatznummer statt der des Abonnenten");
  });
});

test("ANR: fehlende Registrierung wird zur Anrufzeit NICHT nachgeholt - der Anruf bricht ab, ohne Anlegen beim Anbieter", async () => {
  await withVorspann(async ({ srv, mock, telnyx }) => {
    const res = await placeCall(srv, SUBJECT_B);
    assert.equal(res.status, HTTP_CONFLICT);
    assert.equal(mock.registrierungen.length, 0, "keine Registrierung angelegt");
    assert.equal(telnyx.waehlaufrufe.length, 0);
    const nummer = srv.readStore().numbers.find((number) => number.e164 === NUMBER_B);
    assert.ok(!nummer.providerAgentPhoneNumberId, "Kennung bleibt leer");
  }, REGISTRIERUNG_NACHHOLEN_ENV);
});

test("ANR: Boot meldet woertlich, ob die Nummernregistrierung eingehaengt ist", async () => {
  await withElevenLabs(async ({ srv }) => {
    await waitForLog(srv, /\[boot\] Konfig-Warnung: ElevenLabs-Nummernregistrierung NICHT eingehaengt/);
    assert.match(srv.stdout, /\[boot\] Konfig-Warnung: ElevenLabs-Nummernregistrierung NICHT eingehaengt/);
  });
  await withElevenLabs(async ({ srv }) => {
    await waitForLog(srv, /\[boot\] ElevenLabs-Nummernregistrierung: eingehaengt/);
    assert.match(srv.stdout, /\[boot\] ElevenLabs-Nummernregistrierung: eingehaengt/);
  }, REGISTRIERUNG_NACHHOLEN_ENV);
});

const REGISTRIERUNG_ABGELEHNT = 500;

function stdoutZeile(srv, muster) {
  return srv.stdout.split("\n").find((zeile) => muster.test(zeile));
}

test("ANR: Boot nennt bei nicht eingehaengter Registrierung die drei Schalter und die Folge fuer ausgehende Anrufe", async () => {
  await withElevenLabs(async ({ srv }) => {
    await waitForLog(srv, /ElevenLabs-Nummernregistrierung NICHT eingehaengt/);
    const zeile = stdoutZeile(srv, /ElevenLabs-Nummernregistrierung NICHT eingehaengt/);
    assert.ok(zeile, "keine Boot-Warnung");
    for (const schalter of ["PROVISIONING_ENABLED"]) {
      assert.ok(zeile.includes(schalter), `${schalter} fehlt in der Warnung`);
    }
    assert.match(zeile, /ausgehende Anrufe von DIDs ohne Registrierung brechen ab/);
  });
});

test("ANR: ohne eingehaengte Registrierung wird nichts nachgeholt und der Abbruch nennt den Grund", async () => {
  await withVorspann(async ({ srv, mock }) => {
    await placeCall(srv, SUBJECT_B);
    assert.equal(mock.registrierungen.length, 0);
    assert.doesNotMatch(srv.stdout, /Registrierung nachholen/);
    assert.match(srv.stdout, /weg=abbruch grund=keine_eigene_registrierung call=/);
  });
});

test("ANR: eine DID mit eigener Registrierung wird bei eingehaengter Registrierung nicht erneut registriert", async () => {
  await withVorspann(async ({ srv, mock, telnyx }) => {
    const res = await placeCall(srv, SUBJECT_A);
    assert.equal(res.status, HTTP_OK, JSON.stringify(await res.json()));
    assert.deepEqual(mock.registrierungen, []);
    const [wahl] = telnyx.waehlaufrufe;
    assert.equal(wahl.from, NUMBER_A);
    assert.doesNotMatch(srv.stdout, /Registrierung nachholen/);
  }, REGISTRIERUNG_NACHHOLEN_ENV);
});

const RUECKFALL_ZEILE = /\[el-outbound\] Absender-Rueckfall global/;

async function anrufPruefen({ subject = SUBJECT_A, env = {}, ...optionen }, pruefe) {
  await withVorspann(
    async ({ srv, mock, telnyx }) => {
      const res = await placeCall(srv, subject);
      const kennungen = telnyx.waehlaufrufe.map((wahl) => wahl.from);
      await pruefe({ srv, mock, res, kennungen, call: ownCall(srv) });
    },
    env,
    optionen,
  );
}

test("[NIE1] +1-Mandant mit eigener Registrierung startet mit genau seiner Kennung als tenant_did", async () => {
  await anrufPruefen({}, ({ srv, res, kennungen, call }) => {
    assert.equal(res.status, HTTP_OK);
    assert.deepEqual(kennungen, [NUMBER_A]);
    assert.equal(call.from, NUMBER_A);
    assert.doesNotMatch(srv.stdout, RUECKFALL_ZEILE);
  });
});

test("[NIE1] fehlt die Registrierung einer +1-Nummer, wird nichts nachgeholt und nichts gestartet", async () => {
  for (const registrierungStatus of [HTTP_OK, REGISTRIERUNG_ABGELEHNT]) {
    await anrufPruefen(
      { subject: SUBJECT_B, env: REGISTRIERUNG_NACHHOLEN_ENV, registrierungStatus },
      ({ res, mock, kennungen, call }) => {
        assert.equal(res.status, HTTP_CONFLICT);
        assert.deepEqual(mock.registrierungen, []);
        assert.deepEqual(kennungen, []);
        assert.equal(call.failureReason, "not-placed:keine_eigene_registrierung");
      },
    );
  }
});

