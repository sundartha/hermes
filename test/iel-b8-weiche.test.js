// ---- IEL-B8: Rueckfall-Routen und Inbound-Weiche des EL-Inbound-Wegs ------------------------
// /voice/incoming entscheidet EINMAL je Anruf zwischen Budget-Pfad (Schalter aus / nicht gepinnt,
// byte-identisch, Golden-Test) und der Uebergabe an den ElevenLabs-Agenten: Pflichtsatz von UNS,
// dann <Dial><Sip>, dann <Redirect> auf /voice/el-rueckfall?quelle=dial_ende. Die Rueckfall-Route
// entscheidet nur aus dem persistierten Datensatz (Auflegen, Folge-Gather, Rueckfall), der
// SIP-Bein-Callback /voice/el-bein armiert die innere Frist.
//
// A (1-10) rein, B (11) In-Process an einem echten HTTP-Server, C (12-22) Kindprozess.
// Namen beginnen mit "IEL-B8-<n>: " - trifft weder i18nCatalogPattern noch abnahmePattern.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";

import { KOSTENPROFIL } from "../src/billing/kostenarten.js";
import { emergencyBrakeSeconds } from "../src/call-duration.js";
import {
  EL_BINDING_AFTER_ANSWER_MS,
  EL_BRIDGE_START_DEADLINE_MS,
  EL_RUECKFALL_QUELLE,
  elRueckfallUrl,
} from "../src/elevenlabs/inbound-bridges.js";
import { EL_CALL_BINDING_SIP_HEADER } from "../src/elevenlabs/inbound-sip-uri.js";
import {
  EL_DIAL_RING_TIMEOUT_S,
  EL_MIN_CONVERSATION_MS,
  RUECKFALL_ENTSCHEIDUNG,
  elUebergabeDirektiven,
  rueckfallEntscheidungFuer,
} from "../src/elevenlabs/inbound-rueckfall.js";
import { gespeicherteBegruessungFuer } from "../src/i18n/greeting-catalog.js";
import { rueckfallBegruessung, withInboundNotice } from "../src/i18n/inbound-notice.js";
import { LOCALES } from "../src/i18n/locales.js";
import { makeVoiceRoutes } from "../src/routes/voice.js";
import { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER } from "../src/routes/webhooks-elevenlabs-init.js";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, DEFAULT_GREETING, MAX_CALL_DURATION_CAP_S } from "../src/store/defaults.js";
import { telnyxWebhookEvents } from "../src/telephony/adapters/telnyx/webhook-events.js";
import { renderDirectives } from "../src/telephony/adapters/telnyx/render.js";
import { DIRECTIVE, say } from "../src/telephony/directives.js";
import { INBOUND_PATH, logInboundPath } from "../src/telephony/inbound-path.js";
import { billThunk, terminateAndBillCall } from "../src/telephony/call-termination.js";
import { elBeinAnchors, elRueckfallAnchors } from "../src/telephony/webhook-idempotenz.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { CONVERSATION_DONE_WITH_ANALYSIS } from "./fixtures/elevenlabs-conversations.js";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  TELNYX_TEST_TENANT_NUMBER,
  captureConsole,
  makeTelnyxSigner,
  normalizeIncomingTexml,
  nowSeconds,
  postTelnyxIncoming,
  seedCall,
  seedWithTelnyxNumber,
  startServer,
  storeOpsFacade,
  waitForLog,
  waitForStoreState,
  waitUntil,
} from "./helpers.js";
import { CONV_ID, INBOUND_FROM, INBOUND_TO, isoVor, seedInboundElCall, seedWartenderElCall, starteAnbieterAttrappe } from "./_iel-inbound-harness.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_SERVER_ERROR = 500;
const EL_INBOUND = KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI;
const NOTICE = LOCALES.de.inboundNotice;
const PUBLIC_URL = "https://agent.test";
const FAKE_NOW_MS = Date.parse("2026-09-15T10:00:00.000Z");
const AGENT_STIMME = "v_agent";
const BINDUNGS_TOKEN = "0123456789abcdef0123456789abcdef";
const TEST_MAX_DAUER_S = 900;
const SIP_USER = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_USER;
const SIP_PASSWORD = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_PASSWORD;
const INIT_TOKEN = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN;
const AGENT_ID = "agent_b8";
const CALL_SID = "CAielb8";
const OWNER_NAME = "Jonas";
const EINMAL = 1;
const ZWEIMAL = 2;
const ALT_GEBUNDEN_S = 10;
const SPAWN_FRIST_MS = 15000;
const SPAWN_WARTE = { timeoutMs: SPAWN_FRIST_MS, pollIntervalMs: 20 };
const SCHNELLER_POLL_MS = 100;
const RUHE_NACH_BOOT_MS = 600;
const FRIST_UEBERSCHRITTEN_MS = EL_BRIDGE_START_DEADLINE_MS + MS_PER_SECOND;
const HANGUP_XML = `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;
const LEERES_DOKUMENT_XML = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

// EL-Inbound an und der Bootstrap-Tenant gepinnt (Spawn-Env).
const EL_AN_ENV = Object.freeze({
  ELEVENLABS_INBOUND_ENABLED: "true",
  ELEVENLABS_INBOUND_TENANT_IDS: BOOTSTRAP_TENANT_ID,
  ...EL_INBOUND_ACCESS_BOOT_ENV,
});

// ---- Build: reine Bausteine -------------------------------------------------------------------

const isoAt = (ms) => new Date(ms).toISOString();
const elCall = (extra = {}) => ({ status: "active", costProfile: EL_INBOUND, elFallbackAt: null, elevenlabsConversationId: null, elBoundAt: null, ...extra });
const gebundenerCall = (boundMs, extra = {}) => elCall({ elevenlabsConversationId: CONV_ID, elBoundAt: isoAt(boundMs), ...extra });

const XML_PRAEFIX = `<?xml version="1.0" encoding="UTF-8"?><Response>`;
const XML_SUFFIX = "</Response>";
const innerXml = (xml) => xml.slice(XML_PRAEFIX.length, xml.length - XML_SUFFIX.length);

function uebergabeCall(extra = {}) {
  return { id: "call_b8", to: TELNYX_TEST_TENANT_NUMBER, streamToken: BINDUNGS_TOKEN, maxDurationS: TEST_MAX_DAUER_S, ...extra };
}

function uebergabe({ call = uebergabeCall(), voiceId = AGENT_STIMME } = {}) {
  return elUebergabeDirektiven({
    call,
    pflichtsatz: { text: NOTICE, voiceProfile: LOCALES.de.voiceProfile, voiceId },
    zugang: { username: SIP_USER, password: SIP_PASSWORD },
    publicUrl: PUBLIC_URL,
  });
}

const katalogBegruessung = () => gespeicherteBegruessungFuer({ storedGreeting: DEFAULT_GREETING, language: "de", ownerName: OWNER_NAME });

// ---- A: reine Unit-Tests ----------------------------------------------------------------------

test("IEL-B8-1: rueckfallEntscheidungFuer - Aktiv-Status, Brueckenzustand und Gespraechsdauer entscheiden", () => {
  const { AUFLEGEN, FOLGE_GATHER, RUECKFALL_STARTEN } = RUECKFALL_ENTSCHEIDUNG;
  const faelle = [
    ["kein Call", null, AUFLEGEN],
    ["beendet WARTET", elCall({ status: "completed" }), AUFLEGEN],
    ["beendet GEBUNDEN", gebundenerCall(FAKE_NOW_MS, { status: "completed" }), AUFLEGEN],
    ["Budget-Call", { status: "active", costProfile: KOSTENPROFIL.TELNYX_INBOUND_BUDGET }, FOLGE_GATHER],
    ["Call ohne Profil", { status: "active", costProfile: null }, FOLGE_GATHER],
    ["RUECKFALL", elCall({ elFallbackAt: isoAt(FAKE_NOW_MS) }), FOLGE_GATHER],
    ["GEBUNDEN genau an der Grenze", gebundenerCall(FAKE_NOW_MS - EL_MIN_CONVERSATION_MS), AUFLEGEN],
    ["GEBUNDEN knapp unter der Grenze", gebundenerCall(FAKE_NOW_MS - EL_MIN_CONVERSATION_MS + 1), RUECKFALL_STARTEN],
    ["WARTET", elCall(), RUECKFALL_STARTEN],
    ["GEBUNDEN mit unlesbarem elBoundAt", elCall({ elevenlabsConversationId: CONV_ID, elBoundAt: "kaputt" }), RUECKFALL_STARTEN],
  ];
  for (const [name, call, erwartet] of faelle) assert.equal(rueckfallEntscheidungFuer({ call, nowMs: FAKE_NOW_MS }), erwartet, name);
});

test("IEL-B8-2: rueckfallBegruessung mit Katalog-Begruessung - nur exakt dial_ende laesst den Pflichtsatz weg", () => {
  const greeting = katalogBegruessung();
  const voll = withInboundNotice(greeting, NOTICE);
  const ohne = rueckfallBegruessung({ greeting, notice: NOTICE, quelle: EL_RUECKFALL_QUELLE.DIAL_ENDE });
  assert.ok(!ohne.startsWith(NOTICE));
  assert.equal(ohne, voll.slice(`${NOTICE} `.length));
  for (const quelle of [EL_RUECKFALL_QUELLE.FRIST, undefined, "", "DIAL_ENDE", [EL_RUECKFALL_QUELLE.DIAL_ENDE], "x"]) {
    const begruessung = rueckfallBegruessung({ greeting, notice: NOTICE, quelle });
    assert.ok(begruessung.startsWith(NOTICE), JSON.stringify(quelle));
    assert.equal(begruessung, voll, JSON.stringify(quelle));
  }
});

test("IEL-B8-3: rueckfallBegruessung mit Freitext ohne Pflichtsatz - dial_ende die ganze Begruessung, frist mit Pflichtsatz", () => {
  const greeting = "Guten Tag, Praxis Muster, was kann ich tun?";
  assert.equal(rueckfallBegruessung({ greeting, notice: NOTICE, quelle: EL_RUECKFALL_QUELLE.DIAL_ENDE }), greeting);
  assert.equal(rueckfallBegruessung({ greeting, notice: NOTICE, quelle: EL_RUECKFALL_QUELLE.FRIST }), `${NOTICE} ${greeting}`);
});

test("IEL-B8-4: elUebergabeDirektiven - Pflichtsatz in Agentenstimme, Dial/Sip, Redirect dial_ende; so gerendert", () => {
  const call = uebergabeCall();
  const directives = uebergabe({ call });
  const [pflichtsatz, dial, umleitung] = directives;
  assert.deepEqual(directives.map((directive) => directive.kind), [DIRECTIVE.SAY, DIRECTIVE.DIAL_SIP, DIRECTIVE.REDIRECT]);
  assert.equal(pflichtsatz.text, NOTICE);
  assert.equal(pflichtsatz.voiceId, AGENT_STIMME);
  assert.equal(dial.callerId, call.to);
  assert.equal(dial.uri, `sip:${call.to}@sip.rtc.elevenlabs.io:5060;transport=tcp?${EL_CALL_BINDING_SIP_HEADER}=${BINDUNGS_TOKEN}`);
  assert.equal(dial.timeoutS, EL_DIAL_RING_TIMEOUT_S);
  assert.equal(dial.statusCallbackUrl, `${PUBLIC_URL}/voice/el-bein?callId=${call.id}`);
  assert.equal(umleitung.url, `${PUBLIC_URL}${elRueckfallUrl({ callId: call.id, quelle: EL_RUECKFALL_QUELLE.DIAL_ENDE })}`);

  const sayXml = innerXml(renderDirectives([say(NOTICE, LOCALES.de.voiceProfile)]));
  const erwartet =
    `${XML_PRAEFIX}${sayXml}` +
    `<Dial callerId="${call.to}" timeout="${EL_DIAL_RING_TIMEOUT_S}" timeLimit="${TEST_MAX_DAUER_S}">` +
    `<Sip username="${SIP_USER}" password="${SIP_PASSWORD}" statusCallback="${PUBLIC_URL}/voice/el-bein?callId=${call.id}" statusCallbackEvent="answered">` +
    `${dial.uri}</Sip></Dial>` +
    `<Redirect method="POST">${PUBLIC_URL}/voice/el-rueckfall?callId=${call.id}&amp;quelle=dial_ende</Redirect>${XML_SUFFIX}`;
  assert.equal(renderDirectives(directives), erwartet);
});

test('IEL-B8-5: voiceId "" -> die Pflichtsatz-Direktive traegt kein voiceId-Feld', () => {
  const [pflichtsatz] = uebergabe({ voiceId: "" });
  assert.equal(Object.hasOwn(pflichtsatz, "voiceId"), false);
});

test("IEL-B8-6: timeLimitS folgt maxDurationS des Calls, ohne Wert der absoluten Obergrenze", () => {
  assert.equal(uebergabe()[1].timeLimitS, TEST_MAX_DAUER_S);
  assert.equal(uebergabe({ call: uebergabeCall({ maxDurationS: null }) })[1].timeLimitS, MAX_CALL_DURATION_CAP_S);
});

test("IEL-B8-7: Klingelfrist und innere Frist enden vor der aeusseren Frist", () => {
  assert.ok(EL_DIAL_RING_TIMEOUT_S * MS_PER_SECOND < EL_BRIDGE_START_DEADLINE_MS);
  assert.ok(EL_BINDING_AFTER_ANSWER_MS < EL_BRIDGE_START_DEADLINE_MS);
});

test("IEL-B8-8: INBOUND_PATH.ELEVENLABS und seine eine Sonden-Zeile", async () => {
  assert.equal(INBOUND_PATH.ELEVENLABS, "elevenlabs");
  const zeilen = await captureConsole(() => logInboundPath({ callId: "c", path: INBOUND_PATH.ELEVENLABS }));
  assert.deepEqual(zeilen, ['[inbound-path] inbound_path {"callId":"c","path":"elevenlabs"}']);
});

// Alle .js-Dateien unter src/ (rekursiv), als [relativer Pfad, Inhalt].
function quelltexteUnter(verzeichnis) {
  return fs.readdirSync(verzeichnis, { withFileTypes: true }).flatMap((eintrag) => {
    const voll = path.join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) return quelltexteUnter(voll);
    return eintrag.name.endsWith(".js") ? [[voll, fs.readFileSync(voll, "utf8")]] : [];
  });
}

test("IEL-B8-9: der SIP-Zugang hat in src/routes/voice.js genau EINE Lesestelle, sonst nur config und Praedikat", () => {
  const vorkommen = quelltexteUnter("src")
    .map(([datei, inhalt]) => [datei, inhalt.split("sipPassword").length - EINMAL])
    .filter(([, anzahl]) => anzahl > 0);
  const dateien = Object.fromEntries(vorkommen);
  assert.deepEqual(Object.keys(dateien).sort(), ["src/config.js", "src/elevenlabs/inbound-path-decision.js", "src/routes/voice.js"]);
  assert.equal(dateien["src/routes/voice.js"], EINMAL);
});

test("IEL-B8-10: Idempotenz-Anker der zwei Routen - callId plus Unterscheider, sonst nichts", () => {
  const req = (query, body = {}) => ({ query, headers: {}, body });
  assert.deepEqual(elRueckfallAnchors(req({ callId: "c", quelle: "frist" })), ["rk:c:frist"]);
  assert.deepEqual(elRueckfallAnchors(req({ quelle: "frist" })), []);
  assert.deepEqual(elRueckfallAnchors(req({ callId: "c", quelle: ["dial_ende"] })), ["rk:c:"]);
  assert.deepEqual(elBeinAnchors(req({ callId: "c" }, { CallStatus: "answered" })), ["eb:c:answered"]);
  assert.deepEqual(elBeinAnchors(req({}, { CallStatus: "answered" })), []);
  assert.deepEqual(elBeinAnchors(req({ callId: "c" }, { CallStatus: ["answered"] })), ["eb:c:"]);
});

// ---- B: /voice/el-bein In-Process -------------------------------------------------------------

function baueBeinRouter({ state, armiert }) {
  return makeVoiceRoutes({
    store: storeOpsFacade(state),
    config: withConfigNamespaces({ skipTwilioSignatureCheck: true }),
    audit: () => {},
    voiceRender: { render: () => "", turnDirectives: () => [], sayInCallVoice: () => null, followupTurnDirectives: () => [] },
    directiveSynth: { synthesizeDirectiveAudio: async (_call, directives) => directives },
    ttsStore: { takeOnce: async () => null },
    lifecycle: { reattachActiveCall: async () => ({ call: null, logUnknown: true }) },
    finishCall: async () => {},
    webhookEvents: () => telnyxWebhookEvents,
    providerFromHeaders: () => null,
    inboundSignatureVerifier: () => ({ verifyInboundSignature: () => false }),
    terminateAndBillCall,
    billThunk,
    startInboundNachlauf: () => {},
    inboundBridges: { armBindingDeadline: (callId) => armiert.push(callId) },
  });
}

async function mitBeinRoute(state, run) {
  const armiert = [];
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(baueBeinRouter({ state, armiert }));
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const postBein = async (callId, status) => {
    const res = await fetch(`${url}/voice/el-bein?callId=${callId}`, { method: "POST", body: new URLSearchParams({ CallStatus: status }) });
    return { status: res.status, text: await res.text() };
  };
  try {
    await run({ postBein, armiert });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function seedBeinCalls(state) {
  const beendet = seedWartenderElCall(state, { answeredVorS: 1 });
  ops.endCallRecord(state, beendet.id, "completed");
  return {
    answered: seedWartenderElCall(state, { answeredVorS: 1 }),
    inProgress: seedWartenderElCall(state, { answeredVorS: 1 }),
    abgeschlossen: seedWartenderElCall(state, { answeredVorS: 1 }),
    gebunden: seedInboundElCall(state, { answeredVorS: 1 }),
    beendet,
  };
}

test("IEL-B8-11: /voice/el-bein - nur answered/in-progress eines aktiven WARTENDEN Beins armiert die innere Frist, genau einmal", async () => {
  const state = ops.makeDefaultState();
  const calls = seedBeinCalls(state);
  const zeilen = await captureConsole(() =>
    mitBeinRoute(state, async ({ postBein, armiert }) => {
      const antworten = [
        await postBein(calls.answered.id, "answered"),
        await postBein(calls.answered.id, "answered"),
        await postBein(calls.inProgress.id, "in-progress"),
        await postBein(calls.abgeschlossen.id, "completed"),
        await postBein(calls.gebunden.id, "answered"),
        await postBein(calls.beendet.id, "answered"),
        await postBein("call_unbekannt", "answered"),
      ];
      for (const antwort of antworten) assert.equal(antwort.status, HTTP_OK);
      assert.deepEqual(armiert, [calls.answered.id, calls.inProgress.id]);
    }),
  );
  const beinZeilen = zeilen.filter((zeile) => zeile.startsWith("[el-bein]"));
  assert.ok(beinZeilen.some((zeile) => zeile.includes(`"callId":"${calls.answered.id}"`) && zeile.includes('"angenommen":true')));
  for (const zeile of beinZeilen) for (const nummer of [INBOUND_FROM, INBOUND_TO]) assert.ok(!zeile.includes(nummer), zeile);
});

// ---- C: Kindprozess ---------------------------------------------------------------------------

const callsOf = (srv) => srv.readStore().calls;
const einzigerCall = (srv) => callsOf(srv)[0];
const zeilenMit = (srv, marke) => srv.stdout.split(marke).length - EINMAL;
const bindungsTokenAus = (texml) => texml.match(new RegExp(`${EL_CALL_BINDING_SIP_HEADER}=([0-9a-f]{32})`))[1];

async function mitServer({ env = {}, seed, dataDir }, run) {
  const srv = await startServer({ env, seed, dataDir });
  try {
    return await run(srv);
  } finally {
    await srv.stop();
  }
}

async function incomingText(srv, options = {}) {
  const res = await postTelnyxIncoming(srv, { callSid: CALL_SID, ...options });
  assert.equal(res.status, HTTP_OK);
  return res.text();
}

function initAnfrage(srv, token) {
  return fetch(`${srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
    body: JSON.stringify({
      agent_id: AGENT_ID,
      conversation_id: CONV_ID,
      called_number: TELNYX_TEST_TENANT_NUMBER,
      sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: token },
    }),
  });
}

function postVoice(srv, { pfad, body = {} }) {
  return fetch(`${srv.localUrl}${pfad}`, { method: "POST", body: new URLSearchParams(body) });
}

const rueckfallPfad = (callId, quelle) => (quelle === undefined ? `/voice/el-rueckfall?callId=${callId}` : `${elRueckfallUrl({ callId, quelle })}`);

async function postRueckfall(srv, { callId, quelle }) {
  const res = await postVoice(srv, { pfad: rueckfallPfad(callId, quelle) });
  assert.equal(res.status, HTTP_OK);
  return res.text();
}

test("IEL-B8-12: Schalter an + gepinnt - Pflichtsatz, Dial/Sip, Redirect dial_ende; Sonde, Profil, Transkript, kein Passwort im Log", async () => {
  await mitServer({ env: EL_AN_ENV, seed: seedWithTelnyxNumber({ language: "de" }) }, async (srv) => {
    const roh = await incomingText(srv);
    const call = einzigerCall(srv);
    const texml = normalizeIncomingTexml(roh).replace(/X-Hermes-Call-Binding=[0-9a-f]{32}/, "X-Hermes-Call-Binding=<token>");
    const sayXml = innerXml(renderDirectives([say(NOTICE, LOCALES.de.voiceProfile)]));
    const erwartet =
      `${XML_PRAEFIX}${sayXml}` +
      `<Dial callerId="${TELNYX_TEST_TENANT_NUMBER}" timeout="${EL_DIAL_RING_TIMEOUT_S}" timeLimit="${call.maxDurationS}">` +
      `<Sip username="${SIP_USER}" password="${SIP_PASSWORD}" statusCallback="${PUBLIC_URL}/voice/el-bein?callId=call_X" statusCallbackEvent="answered">` +
      `sip:${TELNYX_TEST_TENANT_NUMBER}@sip.rtc.elevenlabs.io:5060;transport=tcp?X-Hermes-Call-Binding=<token></Sip></Dial>` +
      `<Redirect method="POST">${PUBLIC_URL}/voice/el-rueckfall?callId=call_X&amp;quelle=dial_ende</Redirect>${XML_SUFFIX}`;
    assert.equal(texml, erwartet);
    assert.ok(roh.startsWith(`${XML_PRAEFIX}<Say`), "erstes Verb ist der Pflichtsatz");
    assert.ok(!roh.includes("<Gather"));
    assert.equal(bindungsTokenAus(roh), call.streamToken);

    await waitForLog(srv, /"path":"elevenlabs"/);
    assert.equal(zeilenMit(srv, '"path":"elevenlabs"'), EINMAL);
    assert.equal(zeilenMit(srv, '"path":"budget"'), 0);
    assert.ok(!srv.stdout.includes(SIP_PASSWORD), "das SIP-Passwort steht nie im Log");
    assert.equal(call.costProfile, EL_INBOUND);
    assert.equal(call.transcript[0].role, "agent");
    assert.equal(call.transcript[0].text, NOTICE);
    assert.equal(call.elFallbackAt, null);
  });
});

// Leg-Satz +49 -> +49 (Inland) gegen den kalibrierten Inbound-Satz: zwei verschiedene Zahlen,
// damit der Profilwechsel an der Notbremse sichtbar wird.
const INLAND_SATZ_CENTS = 10;
const INBOUND_SATZ_CENTS = 5;
const BUDGET_CENTS = 100;
const TARIF_ENV = Object.freeze({
  VOICE_TARIFF_DOMESTIC_CENTS: String(INLAND_SATZ_CENTS),
  VOICE_TARIFF_INBOUND_CENTS: String(INBOUND_SATZ_CENTS),
});

function budgetSeed() {
  return { ...seedWithTelnyxNumber({ language: "de" }), tenantBudgets: [{ tenantId: BOOTSTRAP_TENANT_ID, budgetCents: BUDGET_CENTS, hardCapCents: BUDGET_CENTS }] };
}

async function maxDauerMit(env) {
  return mitServer({ env: { ...TARIF_ENV, ...env }, seed: budgetSeed() }, async (srv) => {
    await incomingText(srv);
    return einzigerCall(srv).maxDurationS;
  });
}

test("IEL-B8-13: die Notbremse rechnet mit dem EL-Leg-Satz, der Budget-Pfad mit dem Inbound-Satz", async () => {
  const mitEl = await maxDauerMit(EL_AN_ENV);
  const ohneEl = await maxDauerMit({});
  assert.equal(mitEl, emergencyBrakeSeconds({ remainingCents: BUDGET_CENTS, tariffCentsPerMin: INLAND_SATZ_CENTS }));
  assert.equal(ohneEl, emergencyBrakeSeconds({ remainingCents: BUDGET_CENTS, tariffCentsPerMin: INBOUND_SATZ_CENTS }));
  assert.notEqual(mitEl, ohneEl);
});

function erschoepfterSeed() {
  const state = ops.makeDefaultState();
  state.tenants[0].ownerName = OWNER_NAME;
  state.numbers.push({ id: "num_telnyx", e164: TELNYX_TEST_TENANT_NUMBER, tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx", status: "active", providerNumberId: null, language: "de" });
  ops.setTenantBudget(state, BOOTSTRAP_TENANT_ID, { budgetCents: BUDGET_CENTS, hardCapCents: BUDGET_CENTS });
  ops.addVoiceUsageCostCents(state, BOOTSTRAP_TENANT_ID, BUDGET_CENTS, new Date().toISOString());
  return state;
}

test("IEL-B8-14: die Sicherungen vor der Weiche greifen auch mit Schalter an - Kostendecke und unbekannte Nummer", async (ctx) => {
  await mitServer({ env: EL_AN_ENV, seed: erschoepfterSeed() }, async (srv) => {
    await ctx.test("IEL-B8-14a: Tenant-Decke erschoepft -> Ansage + Hangup, kein Dial, kein Call", async () => {
      const texml = await incomingText(srv);
      assert.ok(texml.includes(LOCALES.de.budgetExhaustedHangup), texml);
      assert.ok(texml.includes("<Hangup/>"));
      assert.ok(!texml.includes("<Dial"));
      assert.equal(zeilenMit(srv, '"path":"elevenlabs"'), 0);
      assert.equal(callsOf(srv).length, 0);
    });
    await ctx.test("IEL-B8-14b: To unbekannt -> nicht erreichbar, kein Dial", async () => {
      // Eigene CallSid: dieselbe wie in 14a bekaeme die erste Antwort aus dem Wiederholungs-Riegel.
      const texml = await incomingText(srv, { callSid: "CAielb8unbekannt", to: "+4915299999999" });
      assert.ok(texml.includes("Diese Nummer ist nicht erreichbar"), texml);
      assert.ok(!texml.includes("<Dial"));
    });
  });
});

function signierterUmschlag(signer, felder) {
  const body = new URLSearchParams(felder).toString();
  const ts = String(nowSeconds());
  return {
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded", "telnyx-signature-ed25519": signer.sign(ts, body), "telnyx-timestamp": ts },
  };
}

test("IEL-B8-15: beide Routen liegen hinter der Ed25519-Signaturpruefung - unsigniert 403, signiert 200", async () => {
  const signer = makeTelnyxSigner();
  const env = { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: signer.publicKeyBase64 };
  await mitServer({ env }, async (srv) => {
    for (const pfad of ["/voice/el-rueckfall?callId=x&quelle=frist", "/voice/el-bein?callId=x"]) {
      const res = await postVoice(srv, { pfad, body: { CallStatus: "answered" } });
      assert.equal(res.status, HTTP_FORBIDDEN, pfad);
    }
    await waitForLog(srv, /\[voice-signature\] .*path=\/voice\/el-rueckfall/);
    await waitForLog(srv, /\[voice-signature\] .*path=\/voice\/el-bein/);

    const rueckfall = signierterUmschlag(signer, { CallSid: CALL_SID });
    const signiertRueckfall = await fetch(`${srv.localUrl}/voice/el-rueckfall?callId=x&quelle=frist`, { method: "POST", ...rueckfall });
    assert.equal(signiertRueckfall.status, HTTP_OK);
    assert.equal(await signiertRueckfall.text(), HANGUP_XML);
    const bein = signierterUmschlag(signer, { CallStatus: "answered" });
    const signiertBein = await fetch(`${srv.localUrl}/voice/el-bein?callId=x`, { method: "POST", ...bein });
    assert.equal(signiertBein.status, HTTP_OK);
  });
});

// Das erste gesprochene Verb im Gather (ohne Play-TTS ein <Say>), XML-Entitaeten aufgeloest.
const XML_ENTITAETEN = Object.freeze({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" });
function erstesVerbImGather(xml) {
  const treffer = xml.match(/<Gather[^>]*><Say[^>]*>([^<]*)<\/Say>/);
  return treffer ? treffer[1].replace(/&(amp|lt|gt|quot|apos);/g, (entitaet) => XML_ENTITAETEN[entitaet]) : null;
}

const MATRIX_IDS = Object.freeze({
  wartetDialEnde: "call_b8_a",
  wartetFrist: "call_b8_b",
  wartetOhneQuelle: "call_b8_c",
  wartetBogus: "call_b8_c2",
  jungFrist: "call_b8_d",
  jungDialEnde: "call_b8_e",
  altDialEnde: "call_b8_f",
  budget: "call_b8_i",
  beendet: "call_b8_j",
});

function matrixCall(id, extra = {}) {
  const jetzt = new Date().toISOString();
  return seedCall({ id, direction: "inbound", provider: "telnyx", from: INBOUND_FROM, to: TELNYX_TEST_TENANT_NUMBER, language: "de", answeredAt: jetzt, startedAt: jetzt, maxDurationS: TEST_MAX_DAUER_S, costProfile: EL_INBOUND, ...extra });
}

function matrixSeed() {
  const jung = { elevenlabsConversationId: CONV_ID, elBoundAt: new Date().toISOString() };
  const ids = MATRIX_IDS;
  return {
    ...seedWithTelnyxNumber({ language: "de" }),
    calls: [
      matrixCall(ids.wartetDialEnde),
      matrixCall(ids.wartetFrist),
      matrixCall(ids.wartetOhneQuelle),
      matrixCall(ids.wartetBogus),
      matrixCall(ids.jungFrist, jung),
      matrixCall(ids.jungDialEnde, jung),
      matrixCall(ids.altDialEnde, { elevenlabsConversationId: CONV_ID, elBoundAt: isoVor(ALT_GEBUNDEN_S) }),
      matrixCall(ids.budget, { costProfile: KOSTENPROFIL.TELNYX_INBOUND_BUDGET }),
      matrixCall(ids.beendet, { status: "completed" }),
    ],
  };
}

const storeCall = (srv, id) => callsOf(srv).find((call) => call.id === id);

// logCallId: ein nicht aktiver Call wird nicht re-attacht - die Zeile traegt dann callId null.
async function rueckfallMitLog(srv, { callId, quelle, entscheidung, logCallId = callId }) {
  const text = await postRueckfall(srv, { callId, quelle });
  const logQuelle = Object.values(EL_RUECKFALL_QUELLE).includes(quelle) ? quelle : "unbekannt";
  const zeile = `[el-rueckfall] ${JSON.stringify({ callId: logCallId, quelle: logQuelle, entscheidung })}`;
  await waitUntil(() => srv.stdout.includes(zeile), SPAWN_WARTE);
  return text;
}

// Rueckfall gestartet: Gather mit Begruessung, Marker gesetzt, die Begruessung als neue Agent-Zeile.
async function pruefeRueckfallGestartet(srv, { callId, quelle }) {
  const text = await rueckfallMitLog(srv, { callId, quelle, entscheidung: RUECKFALL_ENTSCHEIDUNG.RUECKFALL_STARTEN });
  const verb = erstesVerbImGather(text);
  assert.ok(verb, text);
  await waitUntil(() => Boolean(storeCall(srv, callId).elFallbackAt), SPAWN_WARTE);
  await waitUntil(() => storeCall(srv, callId).transcript.some((zeile) => zeile.text === verb), SPAWN_WARTE);
  return { text, verb };
}

async function pruefeMitPflichtsatz(srv, { callId, quelle }) {
  const { verb } = await pruefeRueckfallGestartet(srv, { callId, quelle });
  assert.ok(verb.startsWith(NOTICE), verb);
  return verb;
}

async function pruefeOhnePflichtsatz(srv, { callId }) {
  const ergebnis = await pruefeRueckfallGestartet(srv, { callId, quelle: EL_RUECKFALL_QUELLE.DIAL_ENDE });
  assert.ok(!ergebnis.verb.startsWith(NOTICE), ergebnis.verb);
  return ergebnis;
}

const istFolgeGather = (text) => text.includes("<Gather") && !text.includes("<Say") && !text.includes("<Play") && !text.includes("<Hangup");

test("IEL-B8-16: /voice/el-rueckfall - Entscheidungsmatrix am echten Server", async (ctx) => {
  const attrappe = await starteAnbieterAttrappe();
  const env = { ELEVENLABS_API_BASE: attrappe.url, ELEVENLABS_API_KEY: "test-key" };
  const ids = MATRIX_IDS;
  try {
    await mitServer({ env, seed: matrixSeed() }, async (srv) => {
      const erste = {};
      await ctx.test("IEL-B8-16a: WARTET + dial_ende -> Rest ohne Pflichtsatz, Marker, Transkriptzeile", async () => {
        Object.assign(erste, await pruefeOhnePflichtsatz(srv, { callId: ids.wartetDialEnde }));
      });
      await ctx.test("IEL-B8-16b: WARTET + frist -> Pflichtsatz, dann dieselbe Begruessung", async () => {
        const verb = await pruefeMitPflichtsatz(srv, { callId: ids.wartetFrist, quelle: EL_RUECKFALL_QUELLE.FRIST });
        assert.equal(verb, `${NOTICE} ${erste.verb}`);
      });
      await ctx.test("IEL-B8-16c: WARTET ohne quelle bzw. mit quelle=bogus -> Pflichtsatz", async () => {
        await pruefeMitPflichtsatz(srv, { callId: ids.wartetOhneQuelle, quelle: undefined });
        await pruefeMitPflichtsatz(srv, { callId: ids.wartetBogus, quelle: "bogus" });
      });
      await ctx.test("IEL-B8-16d: GEBUNDEN jung + frist -> Pflichtsatz, Marker", async () => {
        await pruefeMitPflichtsatz(srv, { callId: ids.jungFrist, quelle: EL_RUECKFALL_QUELLE.FRIST });
      });
      await ctx.test("IEL-B8-16e: GEBUNDEN jung + dial_ende -> Rest ohne Pflichtsatz, Marker", async () => {
        const { verb } = await pruefeOhnePflichtsatz(srv, { callId: ids.jungDialEnde });
        assert.equal(verb, erste.verb);
      });
      await ctx.test("IEL-B8-16f: GEBUNDEN alt + dial_ende -> genau Hangup, kein Marker", async () => {
        const text = await rueckfallMitLog(srv, { callId: ids.altDialEnde, quelle: EL_RUECKFALL_QUELLE.DIAL_ENDE, entscheidung: RUECKFALL_ENTSCHEIDUNG.AUFLEGEN });
        assert.equal(text, HANGUP_XML);
        assert.equal(storeCall(srv, ids.altDialEnde).elFallbackAt, null);
      });
      await ctx.test("IEL-B8-16g: laufender Rueckfall erneut mit frist -> Folge-Gather, keine weitere Transkriptzeile", async () => {
        const zeilenVorher = storeCall(srv, ids.wartetDialEnde).transcript.length;
        const text = await rueckfallMitLog(srv, { callId: ids.wartetDialEnde, quelle: EL_RUECKFALL_QUELLE.FRIST, entscheidung: RUECKFALL_ENTSCHEIDUNG.FOLGE_GATHER });
        assert.ok(istFolgeGather(text), text);
        assert.equal(storeCall(srv, ids.wartetDialEnde).transcript.length, zeilenVorher);
      });
      await ctx.test("IEL-B8-16h: identische Wiederholung von (a) -> byte-identische Antwort", async () => {
        assert.equal(await postRueckfall(srv, { callId: ids.wartetDialEnde, quelle: EL_RUECKFALL_QUELLE.DIAL_ENDE }), erste.text);
      });
      await ctx.test("IEL-B8-16i: Budget-Call -> Folge-Gather, kein Hangup", async () => {
        const text = await rueckfallMitLog(srv, { callId: ids.budget, quelle: EL_RUECKFALL_QUELLE.FRIST, entscheidung: RUECKFALL_ENTSCHEIDUNG.FOLGE_GATHER });
        assert.ok(istFolgeGather(text), text);
      });
      await ctx.test("IEL-B8-16j: beendeter Call -> Hangup", async () => {
        const text = await rueckfallMitLog(srv, { callId: ids.beendet, quelle: EL_RUECKFALL_QUELLE.FRIST, entscheidung: RUECKFALL_ENTSCHEIDUNG.AUFLEGEN, logCallId: null });
        assert.equal(text, HANGUP_XML);
      });
    });
  } finally {
    await attrappe.close();
  }
});

// Prozess 1 -> Stop -> Datensatz (optional) bearbeiten -> Prozess 2 auf demselben DATA_DIR.
async function mitNeustart({ env, env2 = env, vorbereiten, bearbeiten = () => {} }, run) {
  const srv1 = await startServer({ env, seed: seedWithTelnyxNumber({ language: "de" }) });
  let dataDir;
  try {
    await vorbereiten(srv1);
    dataDir = srv1.dataDir;
  } finally {
    await srv1.stop();
  }
  const storePfad = path.join(dataDir, "store.json");
  const stand = JSON.parse(fs.readFileSync(storePfad, "utf8"));
  bearbeiten(stand.calls[0]);
  fs.writeFileSync(storePfad, JSON.stringify(stand));
  return mitServer({ env: env2, dataDir }, run);
}

test("IEL-B8-17: IE4 - Wiederholung von /voice/incoming nach Neustart bekommt fuer das uebergebene Bein ein leeres Dokument", async () => {
  await mitNeustart({ env: EL_AN_ENV, vorbereiten: (srv) => incomingText(srv) }, async (srv) => {
    const texml = await incomingText(srv);
    assert.equal(texml, LEERES_DOKUMENT_XML);
    assert.equal(callsOf(srv).length, EINMAL);
    assert.equal(zeilenMit(srv, "[inbound-path]"), 0);
  });
});

async function bindeUeberInit(srv) {
  const token = bindungsTokenAus(await incomingText(srv));
  const init = await initAnfrage(srv, token);
  assert.equal(init.status, HTTP_OK, await init.clone().text());
  return init.json();
}

test("IEL-B8-18: E19 - der Pflichtsatz wird in derselben Stimme synthetisiert, die die Init-Antwort als tts.voice_id sendet", async () => {
  const attrappe = await starteAnbieterAttrappe();
  const env = { ...EL_AN_ENV, ELEVENLABS_PLAY_TTS_ENABLED: "true", ELEVENLABS_API_KEY: "test", ELEVENLABS_API_BASE: attrappe.url, ELEVENLABS_AGENT_ID: AGENT_ID };
  try {
    await mitServer({ env, seed: seedWithTelnyxNumber({ language: "de" }) }, async (srv) => {
      const antwort = await bindeUeberInit(srv);
      const [pflichtsatzStimme] = attrappe.ttsStimmen;
      assert.ok(pflichtsatzStimme, "die Erstantwort hat den Pflichtsatz synthetisiert");
      assert.equal(antwort.conversation_config_override.tts.voice_id, pflichtsatzStimme);
    });
  } finally {
    await attrappe.close();
  }
});

// Anthropic-Attrappe: haelt jeden Request-Body fest und antwortet mit einer gueltigen Message.
async function starteModellAttrappe(text) {
  const bodies = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (teil) => (body += teil));
    req.on("end", () => {
      bodies.push(body);
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "msg_b8", type: "message", role: "assistant", model: "claude-haiku-4-5", content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, bodies, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function mitAttrappen({ modellText, conversation }, run) {
  const attrappe = await starteAnbieterAttrappe();
  const modell = await starteModellAttrappe(modellText);
  if (conversation) attrappe.setzeAntwort(conversation);
  const env = { ...EL_AN_ENV, ELEVENLABS_API_KEY: "test", ELEVENLABS_API_BASE: attrappe.url, ELEVENLABS_AGENT_ID: AGENT_ID, ELEVENLABS_RESULT_POLL_MS: String(SCHNELLER_POLL_MS), ANTHROPIC_BASE_URL: modell.url };
  try {
    return await run({ env, attrappe, modell });
  } finally {
    await attrappe.close();
    await modell.close();
  }
}

const postStatus = (srv, callId) => postVoice(srv, { pfad: `/voice/status?callId=${callId}`, body: { CallStatus: "completed" } });
const MODELL_ZUSAMMENFASSUNG = JSON.stringify({ summary: "B8 ok", actionItems: ["Rueckruf"] });

test("IEL-B8-19: Ende-zu-Ende - Uebergabe, Bindung, Carrier-Ende, Nachlauf, Zusammenfassung ueber Pflichtsatz und Anrufer-Zeilen", async () => {
  await mitAttrappen({ modellText: MODELL_ZUSAMMENFASSUNG, conversation: CONVERSATION_DONE_WITH_ANALYSIS }, async ({ env, modell }) => {
    await mitServer({ env, seed: seedWithTelnyxNumber({ language: "de" }) }, async (srv) => {
      await bindeUeberInit(srv);
      await waitForLog(srv, /\[el-init\] gebunden/);
      assert.equal(zeilenMit(srv, "[el-init] gebunden"), EINMAL);
      const { id } = einzigerCall(srv);
      await postStatus(srv, id);
      // Die Zusammenfassung kann nach der Buchung fertig werden - auf alle drei Felder warten.
      const fertig = ([eintrag]) => Boolean(eintrag.billedAt && eintrag.summary && eintrag.inboxEntryAt);
      const [call] = (await waitForStoreState(srv, (zustand) => fertig(zustand.calls), SPAWN_FRIST_MS)).calls;

      const zusammenfassungsAnfrage = modell.bodies.find((body) => body.includes(NOTICE));
      assert.ok(zusammenfassungsAnfrage, "die Zusammenfassung sieht die Pflichtsatz-Zeile");
      const anruferZeilen = CONVERSATION_DONE_WITH_ANALYSIS.transcript.filter((zeile) => zeile.role === "user");
      for (const zeile of anruferZeilen) assert.ok(zusammenfassungsAnfrage.includes(zeile.message), zeile.message);
      assert.equal(call.summary, "B8 ok");
      assert.ok(call.inboxEntryAt);
      assert.equal(zeilenMit(srv, "[el-inbound] nachlauf gestartet"), EINMAL);

      await postStatus(srv, id);
      await waitUntil(() => zeilenMit(srv, "[voice/status]") >= ZWEIMAL, SPAWN_WARTE);
      assert.equal(einzigerCall(srv).billedAt, call.billedAt);
    });
  });
});

test("IEL-B8-20: Neustart waehrend GEBUNDEN - ein laenger laufendes Gespraech wird auf dial_ende aufgelegt, kein Rueckfall", async () => {
  await mitAttrappen({ modellText: MODELL_ZUSAMMENFASSUNG }, async ({ env }) => {
    const bearbeiten = (call) => Object.assign(call, { elBoundAt: isoVor(ALT_GEBUNDEN_S) });
    await mitNeustart({ env, vorbereiten: bindeUeberInit, bearbeiten }, async (srv) => {
      const { id } = einzigerCall(srv);
      const text = await postRueckfall(srv, { callId: id, quelle: EL_RUECKFALL_QUELLE.DIAL_ENDE });
      assert.equal(text, HANGUP_XML);
      assert.equal(einzigerCall(srv).elFallbackAt, null);
    });
  });
});

async function bindeUndFalleZurueck(srv) {
  await bindeUeberInit(srv);
  const { id } = einzigerCall(srv);
  await postRueckfall(srv, { callId: id, quelle: EL_RUECKFALL_QUELLE.DIAL_ENDE });
  await waitForStoreState(srv, (zustand) => Boolean(zustand.calls[0].elFallbackAt), SPAWN_FRIST_MS);
}

test("IEL-B8-21: Neustart waehrend RUECKFALL - kein Ergebnisabruf, Budget-Turn laeuft, Abschluss genau einmal", async () => {
  await mitAttrappen({ modellText: "Gern, worum geht es?" }, async ({ env, attrappe }) => {
    await mitNeustart({ env, vorbereiten: bindeUndFalleZurueck }, async (srv) => {
      const { id } = einzigerCall(srv);
      await new Promise((resolve) => setTimeout(resolve, RUHE_NACH_BOOT_MS));
      assert.equal(attrappe.gets().length, 0, "der Boot re-armiert fuer einen Rueckfall keinen Ergebnisabruf");

      const turn = await postVoice(srv, { pfad: `/voice/turn?callId=${id}`, body: { SpeechResult: "Ich moechte einen Termin." } });
      assert.equal(turn.status, HTTP_OK);
      assert.ok((await turn.text()).includes("<Gather"));

      await postStatus(srv, id);
      const { calls } = await waitForStoreState(srv, (zustand) => Boolean(zustand.calls[0].billedAt), SPAWN_FRIST_MS);
      assert.equal(attrappe.gets().length, 0);
      await postStatus(srv, id);
      await waitUntil(() => zeilenMit(srv, "[voice/status]") >= ZWEIMAL, SPAWN_WARTE);
      assert.equal(einzigerCall(srv).billedAt, calls[0].billedAt);
    });
  });
});

// Telnyx-TeXML-Attrappe: Umleitung (Form-Feld Url) scheitert mit 500, Auflegen (Status) gelingt.
async function starteTelnyxAttrappe() {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (teil) => (body += teil));
    req.on("end", () => {
      const form = Object.fromEntries(new URLSearchParams(body));
      anfragen.push({ method: req.method, pfad: req.url, form });
      res.writeHead(form.Url ? HTTP_SERVER_ERROR : HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify({ sid: CALL_SID }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, anfragen, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("IEL-B8-22: Neustart waehrend WARTET, abgelaufene Frist - Umleitung scheitert, dann wird aufgelegt (nie Stille)", async () => {
  const telnyx = await starteTelnyxAttrappe();
  const env2 = { ...EL_AN_ENV, TELNYX_API_BASE: telnyx.url, TELNYX_API_KEY: "test", TELNYX_ACCOUNT_SID: "acc_b8" };
  const bearbeiten = (call) => Object.assign(call, { answeredAt: new Date(Date.now() - FRIST_UEBERSCHRITTEN_MS).toISOString() });
  try {
    await mitNeustart({ env: EL_AN_ENV, env2, vorbereiten: (srv) => incomingText(srv), bearbeiten }, async (srv) => {
      const { id } = einzigerCall(srv);
      const callAnfragen = () => telnyx.anfragen.filter((anfrage) => anfrage.pfad === `/v2/texml/Accounts/acc_b8/Calls/${CALL_SID}`);
      await waitUntil(() => callAnfragen().length >= ZWEIMAL, SPAWN_WARTE);
      const [umleitung, auflegen] = callAnfragen();
      assert.deepEqual(umleitung.form, { Url: `${PUBLIC_URL}${elRueckfallUrl({ callId: id, quelle: EL_RUECKFALL_QUELLE.FRIST })}`, Method: "POST" });
      assert.deepEqual(auflegen.form, { Status: "completed" });
      await waitForLog(srv, /\[el-inbound\] umleitung_fehlgeschlagen/);
    });
  } finally {
    await telnyx.close();
  }
});
