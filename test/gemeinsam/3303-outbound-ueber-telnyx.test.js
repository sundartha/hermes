import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import {
  OWNER_TEST_NUMBER,
  OWNER_TEST_REGISTRIERUNG,
  EL_INBOUND_ACCESS_BOOT_ENV,
  TELNYX_TEST_PEER_NUMBER,
  seedCall,
  seedState,
  startServer,
} from "../helpers.js";
import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_FORBIDDEN = 403;
const HTTP_SERVER_ERROR = 500;
const EINMAL = 1;
const AGENT_ID = "agent_3303_h4";
const OBJECTIVE = "Termin am Donnerstag vereinbaren";
const TRAEGER_SID = "v3:ob-3303";
const EL_START_PFAD = "/v1/convai/sip-trunk/outbound-call";
const TEXML_ANRUF_PFAD = "/v2/texml/calls/conn_3303";
const EL_SIP_HOST = "sip.rtc.elevenlabs.io";
const WEG_LOG = /\[el-outbound-weg\]/g;
const ELEVENLABS_SIP = KOSTENPROFIL.EL_CONVAI_SIP;
const UEBER_TELNYX = KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI;

const sendeJson = (res, status, nutzlast) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(nutzlast));
};

async function starteAttrappe(antwort) {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", () => {
      anfragen.push({ method: req.method, path: req.url, roh });
      sendeJson(res, HTTP_OK, antwort(req));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { anfragen, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

const elAntwort = (req) => (req.url.startsWith(EL_START_PFAD) ? { success: true, conversation_id: "conv_3303_h4" } : {});
const telnyxAntwort = () => ({ data: { sid: TRAEGER_SID } });

const startsBei = (attrappe, pfad) => attrappe.anfragen.filter((anfrage) => anfrage.method === "POST" && anfrage.path.startsWith(pfad));

const ELEVENLABS_UMGEBUNG = (url) => ({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_API_KEY: "test-key",
  ELEVENLABS_API_BASE: url,
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_3303",
  ELEVENLABS_RESULT_POLL_MS: "60000",
});
const TELNYX_UMGEBUNG = (url) => ({
  TELNYX_API_BASE: url,
  TELNYX_API_KEY: "KEYtest-3303",
  TELNYX_CONNECTION_ID: "conn_3303",
  TELNYX_ACCOUNT_SID: "acct_3303",
});
const SCHALTER_AN = { ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true" };
const INBOUND_AUS = { ELEVENLABS_INBOUND_ENABLED: "false" };
const INBOUND_NICHT_GEPINNT = { ELEVENLABS_INBOUND_TENANT_IDS: "tenant-nicht-der-absender" };

async function mitServer({ env = {}, seed }, run) {
  const el = await starteAttrappe(elAntwort);
  const telnyx = await starteAttrappe(telnyxAntwort);
  const srv = await startServer({
    env: { ...elInboundInitSpawnEnv(AGENT_ID), ...ELEVENLABS_UMGEBUNG(el.url), ...TELNYX_UMGEBUNG(telnyx.url), ...env },
    seed,
  });
  try {
    await run({ srv, el, telnyx });
  } finally {
    await srv.stop();
    await telnyx.close();
    await el.close();
  }
}

const anrufStarten = (srv) =>
  abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: TELNYX_TEST_PEER_NUMBER, objective: OBJECTIVE }),
  });
const anrufIn = (srv, id) => srv.readStore().calls.find((eintrag) => eintrag.id === id);
const einzigerAnruf = (srv) => srv.readStore().calls.find((eintrag) => eintrag.goal === OBJECTIVE);

const voiceOutbound = (srv, callId, felder = {}) =>
  abrufMitFrist(`${srv.localUrl}/voice/outbound?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ CallSid: TRAEGER_SID, ...felder }).toString(),
  });

const strukturVon = (wert) =>
  wert && typeof wert === "object" && !Array.isArray(wert)
    ? Object.fromEntries(Object.keys(wert).sort().map((schluessel) => [schluessel, strukturVon(wert[schluessel])]))
    : typeof wert;

const eigeneNummerOhneRegistrierung = () =>
  seedState({
    numbers: [
      {
        id: "num_ohne_registrierung",
        e164: OWNER_TEST_NUMBER.e164,
        tenantId: TENANT_ID,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
        providerAgentPhoneNumberId: null,
      },
    ],
  });

test("3303-K1: Schalter aus -> sip-trunk/outbound-call 1x, Telnyx-originateCall 0x, el_convai_sip", async () => {
  await mitServer({}, async ({ srv, el, telnyx }) => {
    const antwort = await anrufStarten(srv);
    assert.equal(antwort.status, HTTP_OK, JSON.stringify(await antwort.json()));
    assert.equal(startsBei(el, EL_START_PFAD).length, EINMAL);
    assert.equal(startsBei(telnyx, TEXML_ANRUF_PFAD).length, 0);
    assert.equal(einzigerAnruf(srv).costProfile, ELEVENLABS_SIP);
    assert.doesNotMatch(srv.stdout, WEG_LOG, "ohne Schalter keine neue Log-Zeile");
    const koerper = JSON.parse(startsBei(el, EL_START_PFAD)[0].roh);
    assert.equal(koerper.agent_phone_number_id, OWNER_TEST_REGISTRIERUNG);
    assert.equal(koerper.to_number, TELNYX_TEST_PEER_NUMBER);
    assert.deepEqual(strukturVon(koerper), strukturVon(await alterWegKoerper()));
  });
});

async function alterWegKoerper() {
  let koerper;
  await mitServer({ env: { ...SCHALTER_AN, ...INBOUND_AUS } }, async ({ srv, el }) => {
    await anrufStarten(srv);
    koerper = JSON.parse(startsBei(el, EL_START_PFAD)[0].roh);
  });
  return koerper;
}

test("3303-K2a: Schalter an, Vorpruefung erfuellt -> originateCall 1x mit /voice/outbound-Url, sip-trunk 0x, Profil telnyx_outbound_el_convai", async () => {
  await mitServer({ env: SCHALTER_AN }, async ({ srv, el, telnyx }) => {
    const antwort = await anrufStarten(srv);
    const nutzlast = await antwort.json();
    assert.equal(antwort.status, HTTP_OK, JSON.stringify(nutzlast));
    assert.equal(startsBei(el, EL_START_PFAD).length, 0);
    const wahl = startsBei(telnyx, TEXML_ANRUF_PFAD);
    assert.equal(wahl.length, EINMAL);
    const formular = new URLSearchParams(wahl[0].roh);
    assert.equal(formular.get("Url"), `https://agent.test/voice/outbound?callId=${nutzlast.callId}`);
    assert.equal(formular.get("StatusCallback"), `https://agent.test/voice/status?callId=${nutzlast.callId}`);
    assert.equal(formular.get("From"), OWNER_TEST_NUMBER.e164);
    assert.equal(formular.get("To"), TELNYX_TEST_PEER_NUMBER);
    assert.ok(Number(formular.get("TimeLimit")) > 0);
    const call = anrufIn(srv, nutzlast.callId);
    assert.equal(call.costProfile, UEBER_TELNYX);
    assert.equal(call.twilioSid, TRAEGER_SID);
  });
});

test("3303-K2b+K11: /voice/outbound -> Dial an den EL-SIP-Host ohne Gather und Transkript, auch bei Anrufbeantworter; zweite Zustellung loest keine zweite Uebergabe aus", async () => {
  await mitServer({ env: { ...SCHALTER_AN, MACHINE_DETECTION_ENABLED: "true" } }, async ({ srv }) => {
    const { callId } = await (await anrufStarten(srv)).json();
    const call = anrufIn(srv, callId);
    const antwort = await voiceOutbound(srv, callId, { AnsweredBy: "machine_start" });
    const xml = await antwort.text();
    const erwarteteUri = `sip:${call.from}@${EL_SIP_HOST}:5060;transport=tcp?X-Hermes-Call-Binding=${call.streamToken}`;
    assert.ok(xml.includes(`<Sip`) && xml.includes(erwarteteUri), xml);
    assert.match(xml, /<Dial[^>]*timeLimit="\d+"/);
    assert.ok(xml.includes(`password="${EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_PASSWORD}"`), xml);
    assert.doesNotMatch(xml, /<Gather|<Say|<Hangup/);
    const gespeichert = anrufIn(srv, callId);
    assert.equal(gespeichert.transcript.length, 0);
    assert.ok(gespeichert.answeredAt, "ab dem Abheben gilt die Bruecke als wartend");

    const zweite = await voiceOutbound(srv, callId);
    assert.equal(await zweite.text(), xml, "wiederholte Zustellung: dieselbe Antwort, keine neue Uebergabe");
    assert.equal(srv.stdout.split("[el-outbound-uebergabe]").length - 1, EINMAL);
  });
});

test("3303-K11: nicht aktiver oder schon gebundener Anruf -> kein Dial, keine SIP-Zugangsdaten", async () => {
  const bereitsGebunden = seedCall({
    id: "call_3303_gebunden",
    provider: "telnyx",
    costProfile: UEBER_TELNYX,
    streamToken: "g".repeat(32),
    answeredAt: new Date().toISOString(),
    elevenlabsConversationId: "conv_3303_gebunden",
    elBoundAt: new Date().toISOString(),
  });
  const beendet = seedCall({ id: "call_3303_beendet", provider: "telnyx", costProfile: UEBER_TELNYX, streamToken: "b".repeat(32), status: "failed", endedAt: new Date().toISOString() });
  await mitServer({ env: SCHALTER_AN, seed: seedState({ calls: [bereitsGebunden, beendet] }) }, async ({ srv }) => {
    const geheimnis = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_PASSWORD;
    const beendetXml = await (await voiceOutbound(srv, beendet.id)).text();
    assert.match(beendetXml, /<Hangup\s*\/>/);
    for (const xml of [beendetXml, await (await voiceOutbound(srv, bereitsGebunden.id)).text()]) {
      assert.doesNotMatch(xml, /<Dial|<Sip|<Gather/);
      assert.ok(!xml.includes(geheimnis), xml);
      assert.doesNotMatch(xml, /elevenlabs/i);
    }
  });
});

test("3303-K4: Absender bleibt die eigene Registrierung; ohne sie laeuft der alte Weg bzw. der Abbruch wie heute", async () => {
  await mitServer({ env: SCHALTER_AN }, async ({ srv, telnyx }) => {
    await anrufStarten(srv);
    assert.equal(new URLSearchParams(startsBei(telnyx, TEXML_ANRUF_PFAD)[0].roh).get("From"), OWNER_TEST_NUMBER.e164);
    assert.equal(einzigerAnruf(srv).fromRegistrationSource ?? null, null, "der neue Weg waehlt nicht ueber die EL-Registrierung");
  });
  await mitServer({ env: SCHALTER_AN, seed: eigeneNummerOhneRegistrierung() }, async ({ srv, el, telnyx }) => {
    const antwort = await anrufStarten(srv);
    assert.equal(antwort.status, HTTP_SERVER_ERROR, "Abbruch wie heute");
    assert.equal(startsBei(el, EL_START_PFAD).length, 0);
    assert.equal(startsBei(telnyx, TEXML_ANRUF_PFAD).length, 0);
    assert.match(srv.stdout, /\[el-outbound-weg\] weg=el_sip_trunk grund=keine_eigene_registrierung/);
    assert.equal(einzigerAnruf(srv).status, "failed");
  });
});

test("3303-K5: Vorpruefung scheitert (Inbound-Weg aus / Tenant nicht freigegeben) -> alter Weg, Telnyx 0x, Log-Zeile mit Grund", async () => {
  for (const [name, env] of [["inbound aus", INBOUND_AUS], ["nicht gepinnt", INBOUND_NICHT_GEPINNT]]) {
    await mitServer({ env: { ...SCHALTER_AN, ...env } }, async ({ srv, el, telnyx }) => {
      const antwort = await anrufStarten(srv);
      assert.equal(antwort.status, HTTP_OK, `${name}: ${JSON.stringify(await antwort.json())}`);
      assert.equal(startsBei(telnyx, TEXML_ANRUF_PFAD).length, 0, name);
      assert.equal(startsBei(el, EL_START_PFAD).length, EINMAL, name);
      assert.equal(einzigerAnruf(srv).costProfile, ELEVENLABS_SIP, name);
      assert.match(srv.stdout, /\[el-outbound-weg\] weg=el_sip_trunk grund=inbound_weg_nicht_bereit/, name);
    });
  }
});

test("3303-K12: Gates laufen vor beiden Waehlwegen -> OUTBOUND_FROZEN und erschoepfte Kostendecke waehlen nie", async () => {
  const kostendeckeLeer = seedState({ calls: [] });
  kostendeckeLeer.tenantBudgets = [{ tenantId: TENANT_ID, budgetCents: 0, hardCapCents: 0 }];
  for (const [name, env, seed, status] of [
    ["frozen", { OUTBOUND_FROZEN: "true" }, undefined, HTTP_FORBIDDEN],
    ["kostendecke", {}, kostendeckeLeer, HTTP_PAYMENT_REQUIRED],
  ]) {
    await mitServer({ env: { ...SCHALTER_AN, ...env }, seed }, async ({ srv, el, telnyx }) => {
      const antwort = await anrufStarten(srv);
      assert.equal(antwort.status, status, name);
      assert.equal(startsBei(telnyx, TEXML_ANRUF_PFAD).length, 0, name);
      assert.equal(startsBei(el, EL_START_PFAD).length, 0, name);
    });
  }
});
