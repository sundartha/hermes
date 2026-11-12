import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  OWNER_TEST_FIRST_NAME,
  OWNER_TEST_REGISTRIERUNG,
  makeTelnyxSigner,
  nowSeconds,
  seedCall,
  seedState,
  startServer,
  waitUntil as wartebis,
} from "../helpers.js";
import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { echtWarten } from "../echt-warten.js";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const HTTP_UNPROCESSABLE = 422;
const HTTP_SERVER_FEHLER = 500;
const WARTE_FRIST_MS = 5_000;
const RUHE_MS = 150;
const NUMMER_PRAEFIX = "+4915112370";
const EINMAL = 1;
const AUDIO_BYTES = 200_000;
const ZWEIMAL = 2;
const MAX_DAUER_S = 2;
const EL_KLINGEL_FRIST_S = 10;
const AGENT_ID = "agent_3365_h2b";
const OBJECTIVE = "Termin am Donnerstag vereinbaren";
const APP_ID = "cc_app_3365_2b";
const TELNYX_KEY = "KEYtest-3365";
const EL_KEY = "test-key-3365";
const PUBLIC_URL = "https://agent.test";
const FEHLER_DETAIL = "detail-el-geheimnis";
const SIP_ZUGANG = EL_INBOUND_ACCESS_BOOT_ENV;
const BINDUNG_HEADER = "X-Hermes-Call-Binding";

const waitUntil = (bedingung) => wartebis(bedingung, { timeoutMs: WARTE_FRIST_MS });
const koerper = (anfrage) => JSON.parse(anfrage.roh);
const istEl = (anfrage) => koerper(anfrage).command_id.endsWith("-el");
const calleeVon = (callId) => `cc_callee_${callId}`;
const elVon = (callId) => `cc_el_${callId}`;
const wahlen = (attrappe) => attrappe.anfragen.filter((anfrage) => anfrage.path === "/v2/calls");
const elWahlen = (attrappe, callId) => wahlen(attrappe).filter((anfrage) => istEl(anfrage) && koerper(anfrage).webhook_url.endsWith(callId));
const aktionen = (attrappe, bein, aktion) => attrappe.anfragen.filter((anfrage) => anfrage.path === `/v2/calls/${bein}/actions/${aktion}`);
const aufleger = (attrappe, callId) => [aktionen(attrappe, calleeVon(callId), "hangup").length, aktionen(attrappe, elVon(callId), "hangup").length];

function antworteElWahl(res, anfrage, steuerung) {
  if (steuerung.elFehler) {
    res.writeHead(HTTP_UNPROCESSABLE, { "content-type": "application/json" });
    return res.end(JSON.stringify({ errors: [{ code: "10015", title: "Invalid", detail: FEHLER_DETAIL }] }));
  }
  const callId = koerper(anfrage).command_id.replace(/^vorspann-/, "").replace(/-el$/, "");
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: steuerung.elOhneKennung ? {} : { call_control_id: elVon(callId) } }));
}

function beantworte({ req, res }, anfrage, steuerung) {
  if (req.url.startsWith("/v1/text-to-speech/")) {
    res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
    return res.end(Buffer.alloc(AUDIO_BYTES, 1));
  }
  if (req.url.endsWith(steuerung.hangupFehlerAn ?? "/gibt-es-nicht")) {
    res.writeHead(HTTP_SERVER_FEHLER, { "content-type": "application/json" });
    return res.end(JSON.stringify({ errors: [{ code: "99", title: "Fehler" }] }));
  }
  if (req.url === "/v2/calls" && istEl(anfrage)) return antworteElWahl(res, anfrage, steuerung);
  if (req.url === "/v2/calls") {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    return res.end(JSON.stringify({ data: { call_control_id: calleeVon(koerper(anfrage).command_id.replace(/^vorspann-/, "")) } }));
  }
  if (steuerung.wiedergabeFehler && req.url.endsWith("/actions/playback_start")) {
    res.writeHead(HTTP_SERVER_FEHLER, { "content-type": "application/json" });
    return res.end(JSON.stringify({ errors: [{ code: "99", title: "Fehler" }] }));
  }
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: { sid: "v3:ob-3365-2b", result: "ok" } }));
}

async function starteAttrappe() {
  const anfragen = [];
  const steuerung = { gehalten: [] };
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", async () => {
      const anfrage = { method: req.method, path: req.url, roh };
      anfragen.push(anfrage);
      const haltenBis = steuerung.haltenBis;
      const gehoertDazu = req.url.endsWith("/actions/playback_start") || (req.url === "/v2/calls" && roh.includes("-el"));
      if (haltenBis && gehoertDazu) await haltenBis(steuerung);
      beantworte({ req, res }, anfrage, steuerung);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    anfragen,
    steuerung,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

const umgebung = {};

const serverEnv = (attrappe, signer, zusatz = {}) => ({
  ...elInboundInitSpawnEnv(AGENT_ID),
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  TELNYX_CALL_CONTROL_APP_ID: APP_ID,
  ELEVENLABS_API_KEY: EL_KEY,
  ELEVENLABS_API_BASE: attrappe.url,
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_3365_2b",
  ELEVENLABS_RESULT_POLL_MS: "60000",
  TELNYX_API_BASE: attrappe.url,
  TELNYX_API_KEY: TELNYX_KEY,
  TELNYX_CONNECTION_ID: "conn_3365",
  TELNYX_ACCOUNT_SID: "acct_3365",
  SKIP_TWILIO_SIGNATURE_CHECK: "false",
  TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
  PUBLIC_URL,
  ...zusatz,
});

const mandant = () => seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] });

before(async () => {
  umgebung.attrappe = await starteAttrappe();
  umgebung.signer = makeTelnyxSigner();
  umgebung.srv = await startServer({ env: serverEnv(umgebung.attrappe, umgebung.signer), seed: mandant() });
});

after(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

let zaehler = 0;
const anrufStarten = (zusatz = {}) =>
  abrufMitFrist(`${umgebung.srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: `${NUMMER_PRAEFIX}${String((zaehler += EINMAL)).padStart(3, "0")}`, objective: OBJECTIVE, ...zusatz }),
  });
const anrufIn = (id) => {
  const { calls } = umgebung.srv.readStore();
  return calls.find((eintrag) => eintrag.id === id);
};
const neuerAnruf = async (zusatz) => (await (await anrufStarten(zusatz)).json()).callId;
const abbrechen = (callId) => abrufMitFrist(`${umgebung.srv.localUrl}/api/calls/${callId}/cancel`, { method: "POST" });

function sendeEreignis(callId, typ) {
  const roh = JSON.stringify({ data: { id: `evt-2b-${(zaehler += EINMAL)}`, event_type: typ, payload: { call_control_id: calleeVon(callId) } } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}

async function mitSteuerung(werte, run) {
  Object.assign(umgebung.attrappe.steuerung, werte);
  try {
    await run();
  } finally {
    for (const schluessel of Object.keys(werte)) delete umgebung.attrappe.steuerung[schluessel];
  }
}

const beideAnfragenAbwarten = (steuerung) =>
  new Promise((resolve) => {
    steuerung.gehalten.push(resolve);
    if (steuerung.gehalten.length === ZWEIMAL) steuerung.gehalten.splice(0).forEach((frei) => frei());
  });

async function hebeAb(callId) {
  assert.equal((await sendeEreignis(callId, "call.answered")).status, HTTP_OK);
  await waitUntil(() => elWahlen(umgebung.attrappe, callId).length === EINMAL);
  await waitUntil(() => aktionen(umgebung.attrappe, calleeVon(callId), "playback_start").length === EINMAL);
}

test("3365-D1: call.answered -> EL-Wahl und playback_start laufen gleichzeitig, EL-Wahl mit allen Feldern", async () => {
  const { attrappe } = umgebung;
  await mitSteuerung({ haltenBis: beideAnfragenAbwarten }, async () => {
    const callId = await neuerAnruf();
    const call = anrufIn(callId);
    await hebeAb(callId);
    assert.deepEqual(koerper(elWahlen(attrappe, callId)[0]), {
      connection_id: APP_ID,
      to: `sip:${call.from}@sip.rtc.elevenlabs.io`,
      from: call.from,
      link_to: calleeVon(callId),
      custom_headers: [{ name: BINDUNG_HEADER, value: call.streamToken }],
      sip_auth_username: SIP_ZUGANG.ELEVENLABS_INBOUND_SIP_USER,
      sip_auth_password: SIP_ZUGANG.ELEVENLABS_INBOUND_SIP_PASSWORD,
      sip_transport_protocol: "TCP",
      timeout_secs: EL_KLINGEL_FRIST_S,
      time_limit_secs: call.maxDurationS,
      webhook_url: `${PUBLIC_URL}/voice/vorspann?callId=${callId}`,
      command_id: `vorspann-${callId}-el`,
    });
  });
});

test("3365-D1: zweites call.answered -> keine zweite EL-Wahl", async () => {
  const callId = await neuerAnruf();
  await hebeAb(callId);
  assert.equal((await sendeEreignis(callId, "call.answered")).status, HTTP_OK);
  await echtWarten(RUHE_MS);
  assert.equal(elWahlen(umgebung.attrappe, callId).length, EINMAL);
});

test("3365-D2: Angerufener legt nach dem Abheben auf -> EL-Bein wird aufgelegt, Anruf completed", async () => {
  const { attrappe } = umgebung;
  const callId = await neuerAnruf();
  await hebeAb(callId);
  await sendeEreignis(callId, "call.hangup");
  await waitUntil(() => aktionen(attrappe, elVon(callId), "hangup").length === EINMAL);
  await waitUntil(() => anrufIn(callId).status === "completed");
  assert.deepEqual(aufleger(attrappe, callId), [0, 1]);
});

async function mitHaengenderElWahl(pruefe) {
  let freigeben;
  const elWartet = new Promise((resolve) => (freigeben = resolve));
  await mitSteuerung({ haltenBis: () => elWartet }, async () => {
    const callId = await neuerAnruf();
    await sendeEreignis(callId, "call.answered");
    await waitUntil(() => elWahlen(umgebung.attrappe, callId).length === EINMAL);
    await pruefe(callId, freigeben);
  });
}

test("3365-D2: Auflegen waehrend der EL-Wahl -> das danach angelegte EL-Bein wird sofort aufgelegt", async () => {
  const { attrappe } = umgebung;
  await mitHaengenderElWahl(async (callId, freigeben) => {
    await sendeEreignis(callId, "call.hangup");
    await waitUntil(() => anrufIn(callId).status === "completed");
    assert.equal(aktionen(attrappe, elVon(callId), "hangup").length, 0);
    freigeben();
    await waitUntil(() => aktionen(attrappe, elVon(callId), "hangup").length === EINMAL);
  });
});

test("3365-D2: scheitert die Wiedergabe -> beide Beine aufgelegt", async () => {
  const { attrappe, srv } = umgebung;
  await mitSteuerung({ wiedergabeFehler: true }, async () => {
    const callId = await neuerAnruf();
    await sendeEreignis(callId, "call.answered");
    await waitUntil(() => aufleger(attrappe, callId).join() === "1,1");
    assert.ok(srv.stdout.includes(`[el-vorspann] abheben fehlgeschlagen call=${callId}:`), srv.stdout);
  });
});

test("3365-D2: scheitert die EL-Wahl -> Angerufener aufgelegt, Fehler ohne Anbieter-Detail im Log", async () => {
  const { attrappe, srv } = umgebung;
  await mitSteuerung({ elFehler: true }, async () => {
    const callId = await neuerAnruf();
    const logVorher = srv.stdout.length;
    await sendeEreignis(callId, "call.answered");
    await waitUntil(() => aktionen(attrappe, calleeVon(callId), "hangup").length === EINMAL);
    await waitUntil(() => srv.stdout.includes(`[el-vorspann] el-wahl fehlgeschlagen call=${callId}:`));
    assert.equal(aktionen(attrappe, elVon(callId), "hangup").length, 0);
    assert.ok(!srv.stdout.includes(FEHLER_DETAIL), "Anbieter-Detail im Log");
    assert.ok(!srv.stdout.slice(logVorher).includes("auflegen fehlgeschlagen"), srv.stdout);
  });
});

test("3365-D2: liefert der Anbieter fuer das EL-Bein keine Kennung -> Wahl gescheitert, Angerufener aufgelegt", async () => {
  const { attrappe, srv } = umgebung;
  await mitSteuerung({ elOhneKennung: true }, async () => {
    const callId = await neuerAnruf();
    await sendeEreignis(callId, "call.answered");
    await waitUntil(() => aktionen(attrappe, calleeVon(callId), "hangup").length === EINMAL);
    await waitUntil(() => srv.stdout.includes(`[el-vorspann] el-wahl fehlgeschlagen call=${callId}: Der Anbieter hat keine Kennung fuer das EL-Bein geliefert`));
  });
});

test("3365-D3: cancel_call nach dem Abheben legt beide Beine auf, auch wenn das erste Auflegen scheitert", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await neuerAnruf();
  await hebeAb(callId);
  await mitSteuerung({ hangupFehlerAn: `${calleeVon(callId)}/actions/hangup` }, async () => {
    assert.equal((await abbrechen(callId)).status, HTTP_OK);
    await waitUntil(() => aufleger(attrappe, callId).join() === "1,1");
    assert.ok(srv.stdout.includes("[cancel]"), srv.stdout);
  });
});

test("3365-D3: cancel_call waehrend der EL-Wahl -> EL-Bein wird nach dem Anlegen aufgelegt", async () => {
  const { attrappe, srv } = umgebung;
  await mitHaengenderElWahl(async (callId, freigeben) => {
    const logVorher = srv.stdout.length;
    assert.equal((await abbrechen(callId)).status, HTTP_OK);
    await waitUntil(() => aktionen(attrappe, calleeVon(callId), "hangup").length === EINMAL);
    assert.equal(aktionen(attrappe, elVon(callId), "hangup").length, 0);
    assert.ok(!srv.stdout.slice(logVorher).includes("[cancel]"), srv.stdout);
    freigeben();
    await waitUntil(() => aktionen(attrappe, elVon(callId), "hangup").length === EINMAL);
  });
});

test("3365-D3: Max-Dauer legt beide Beine auf", async () => {
  const { attrappe } = umgebung;
  const callId = await neuerAnruf({ max_duration_s: MAX_DAUER_S });
  await hebeAb(callId);
  await waitUntil(() => aufleger(attrappe, callId).join() === "1,1");
});

test("3365-D4: Passwort und Bindungs-Token stehen nur im Dial-Koerper, nie in Pfad, webhook_url, to oder Log", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await neuerAnruf();
  await hebeAb(callId);
  const geheimnisse = [SIP_ZUGANG.ELEVENLABS_INBOUND_SIP_PASSWORD, anrufIn(callId).streamToken];
  const wahl = koerper(elWahlen(attrappe, callId)[0]);
  for (const geheimnis of geheimnisse) {
    for (const stelle of [wahl.webhook_url, wahl.to, wahl.from, wahl.command_id, ...attrappe.anfragen.map((anfrage) => anfrage.path)])
      assert.ok(!stelle.includes(geheimnis), `Geheimnis in ${stelle}`);
    assert.ok(!srv.stdout.includes(geheimnis), "Geheimnis im Log");
  }
  assert.equal(wahl.sip_auth_password, geheimnisse[0]);
  assert.equal(wahl.custom_headers[0].value, geheimnisse[1]);
});

async function mitEigenemServer({ env, seed }, run) {
  const haupt = umgebung.srv;
  umgebung.srv = await startServer({ env: serverEnv(umgebung.attrappe, umgebung.signer, env), seed });
  try {
    await run();
  } finally {
    await umgebung.srv.stop();
    umgebung.srv = haupt;
  }
}

const KOSTENDECKE_CENT = 800;
const MINUTENTARIF_CENT = "200";
const WACHE_MS = "200";
const MS_JE_SEKUNDE = 1000;
const LAUFZEIT_ZWEI_MINUTEN_S = 90;

function seedMitLaufendemFremdanruf() {
  const seed = mandant();
  const beginn = new Date(Date.now() - LAUFZEIT_ZWEI_MINUTEN_S * MS_JE_SEKUNDE).toISOString();
  seed.calls = [
    {
      id: "call_3365_laufend",
      direction: "outbound",
      status: "active",
      tenantId: TENANT_ID,
      from: "+4915112340001",
      to: "+4915112340002",
      goal: "Laufender Anruf",
      startedAt: beginn,
      answeredAt: beginn,
      maxDurationS: 1800,
    },
  ];
  return seed;
}
const UNGUELTIGE_NUMMER = "+49151x123";

test("3365-K18: die Tenant-Kostendecke reisst nach dem Abheben -> beide Beine aufgelegt, Endgrund budget-exhausted", async () => {
  const { attrappe } = umgebung;
  const env = {
    DEFAULT_TENANT_BUDGET_CENTS: String(KOSTENDECKE_CENT),
    VOICE_TARIFF_DOMESTIC_CENTS: MINUTENTARIF_CENT,
    VOICE_TARIFF_DEFAULT_CENTS: MINUTENTARIF_CENT,
    BUDGET_WATCHDOG_INTERVAL_MS: WACHE_MS,
  };
  await mitEigenemServer({ env, seed: seedMitLaufendemFremdanruf() }, async () => {
    const callId = await neuerAnruf();
    await hebeAb(callId);
    assert.deepEqual(aufleger(attrappe, callId), [0, 0]);
    assert.equal(anrufIn(callId).status, "active");
    await neuerAnruf();
    await waitUntil(() => aufleger(attrappe, callId).join() === "1,1");
    await waitUntil(() => anrufIn(callId).status === "completed");
    assert.equal(anrufIn(callId).failureReason, "budget-exhausted");
  });
});

test("3365-K8: aktive Nummer ohne gueltige E.164 -> keine EL-Wahl, Angerufener aufgelegt", async () => {
  const { attrappe } = umgebung;
  const seed = mandant();
  seed.numbers = [
    { id: "num_ungueltig", e164: UNGUELTIGE_NUMMER, tenantId: TENANT_ID, provider: "telnyx", status: "active", providerNumberId: null, providerAgentPhoneNumberId: OWNER_TEST_REGISTRIERUNG },
  ];
  await mitEigenemServer({ env: {}, seed }, async () => {
    const callId = await neuerAnruf();
    assert.equal(anrufIn(callId).from, UNGUELTIGE_NUMMER);
    await sendeEreignis(callId, "call.answered");
    await waitUntil(() => aktionen(attrappe, calleeVon(callId), "hangup").length === EINMAL);
    await waitUntil(() => umgebung.srv.stdout.includes(`[el-vorspann] el-wahl fehlgeschlagen call=${callId}: elSipZiel: Absender ist keine E.164-Nummer`));
    assert.equal(elWahlen(attrappe, callId).length, 0);
  });
});
