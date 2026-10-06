import http from "node:http";
import { voiceMinutesOf } from "../src/billing/metering.js";
import { KOSTENPROFIL } from "../src/billing/kostenarten.js";
import { EL_CALL_BINDING_SIP_HEADER } from "../src/elevenlabs/inbound-sip-uri.js";
import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { billThunk, terminateAndBillCall } from "../src/telephony/call-termination.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { CONVERSATION_DONE_WITH_ANALYSIS, CONVERSATION_IN_PROGRESS } from "./fixtures/elevenlabs-conversations.js";
import { EL_INBOUND_ACCESS_BOOT_ENV, seedCall, seedState, storeOpsFacade, waitUntil, withFetch } from "./helpers.js";

export const ACCOUNT = { apiKey: "test-key", apiBase: "https://el.test" };
export const CONV_ID = "conv_iel_b4";
export const POLL_MS = 5;
export const HTTP_OK = 200;
const WARTE_FRIST_MS = 5000;
export const WARTE = { timeoutMs: WARTE_FRIST_MS };
export const RUHE_TAKTE = 4;
export const TRAEGER_SID = "v3:inbound-leg-sid";
export const INBOUND_FROM = "+491701111111";
export const INBOUND_TO = "+491700000000";
export const FIXTURE_ZEILEN = CONVERSATION_DONE_WITH_ANALYSIS.transcript.length;

export const isoVor = (sekunden, jetztMs = Date.now()) => new Date(jetztMs - sekunden * MS_PER_SECOND).toISOString();
export const ruhe = (takte) => new Promise((resolve) => setTimeout(resolve, takte * POLL_MS));
export const okAntwort = (conversation) => ({ ok: true, status: HTTP_OK, json: async () => conversation });
export const fehlerAntwort = (envelope) => ({ ok: false, status: envelope.httpStatus, json: async () => envelope.body });

export function seedWartenderElCall(state, { answeredVorS, jetztMs = Date.now() }) {
  const call = ops.createCall(state, {
    direction: "inbound",
    from: INBOUND_FROM,
    to: INBOUND_TO,
    twilioSid: TRAEGER_SID,
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  call.startedAt = isoVor(answeredVorS, jetztMs);
  call.answeredAt = call.startedAt;
  ops.recordCostProfile(state, call.id, KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI);
  return call;
}

export function seedInboundElCall(state, { answeredVorS, nachlaufVorS = null }) {
  const jetztMs = Date.now();
  const call = seedWartenderElCall(state, { answeredVorS, jetztMs });
  ops.bindInboundElConversation(state, call.id, { conversationId: CONV_ID, nowIso: new Date().toISOString() });
  if (nachlaufVorS !== null) ops.markInboundElNachlaufStarted(state, call.id, isoVor(nachlaufVorS, jetztMs));
  return call;
}

const SPAWN_MAX_DAUER_S = 600;

export function spawnSeedWartenderElCall({ callId, bindungsToken, answeredVorS }) {
  const beantwortetAt = isoVor(answeredVorS);
  return seedState({
    settings: { allowSummaries: false },
    calls: [
      seedCall({
        id: callId,
        direction: "inbound",
        provider: "telnyx",
        from: INBOUND_FROM,
        to: INBOUND_TO,
        twilioSid: TRAEGER_SID,
        answeredAt: beantwortetAt,
        startedAt: beantwortetAt,
        maxDurationS: SPAWN_MAX_DAUER_S,
        costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
        streamToken: bindungsToken,
      }),
    ],
  });
}

export const elInboundInitSpawnEnv = (agentId) => ({
  ELEVENLABS_INBOUND_ENABLED: "true",
  ELEVENLABS_INBOUND_TENANT_IDS: BOOTSTRAP_TENANT_ID,
  ...EL_INBOUND_ACCESS_BOOT_ENV,
  ELEVENLABS_AGENT_ID: agentId,
});

export const initBindungsKoerper = ({ bindung, agentId, conversationId }) => ({
  agent_id: agentId,
  conversation_id: conversationId,
  called_number: INBOUND_TO,
  sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: bindung },
});

export function makeAnbieter(antwort) {
  const anbieter = { gets: 0, deletes: 0, offen: 0, maxOffen: 0, antwort };
  anbieter.setzeAntwort = (neueAntwort) => {
    anbieter.antwort = neueAntwort;
  };
  anbieter.fetch = async (_url, init) => {
    if (init.method === "DELETE") {
      anbieter.deletes += 1;
      return okAntwort({});
    }
    anbieter.gets += 1;
    anbieter.offen += 1;
    anbieter.maxOffen = Math.max(anbieter.maxOffen, anbieter.offen);
    try {
      return await anbieter.antwort();
    } finally {
      anbieter.offen -= 1;
    }
  };
  return anbieter;
}

export function baueStore(state, beobachtung) {
  return {
    ...storeOpsFacade(state),
    setCallEndedAt: (id, status, iso) => ops.setCallEndedAt(state, id, status, iso).call,
    markInboundElNachlaufStarted: (id, iso) => ops.markInboundElNachlaufStarted(state, id, iso),
    markAnswered: (id) => ops.markAnswered(state, id),
    recordElDetectorCounts: (id) => beobachtung.detektorZaehlungen.push(id),
    purgeTranscript: (id) => ops.purgeTranscript(state, id),
    markBilled: (id) => ops.markBilled(state, id),
    withStoreLock: (fn) => fn(),
    releaseOutboundReserve: async () => {},
    tenantContext: () => ({ settings: {} }),
    addNotification: () => {},
    markInboxEntry: () => {},
  };
}

export function baueHarness(state) {
  const beobachtung = { gebucht: [], zusammenfassungen: [], detektorZaehlungen: [], traegerAuflegen: [] };
  const store = baueStore(state, beobachtung);
  const callFinish = makeCallFinish({
    store,
    config: { billing: { paymentEnabled: false }, privacy: { diagnosticRetentionDays: 0 } },
    metering: { recordVoiceMinuteMeter() {}, reconcileVoiceBudget: (call) => beobachtung.gebucht.push(voiceMinutesOf(call)) },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall: async (call) => {
      beobachtung.zusammenfassungen.push({ summary: call.summary, rollen: call.transcript.map((zeile) => zeile.role) });
      return null;
    },
    planSummarySms: () => ({ send: false }),
    audit: () => {},
  });
  const el = makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({ elevenLabsOutbound: { ...ACCOUNT, resultPollMs: POLL_MS } }),
    terminateAndBillCall,
    billThunk,
    finishCall: callFinish.finishCall,
    endCarrierCall: (callId) => beobachtung.traegerAuflegen.push(callId),
  });
  return { el, store, callFinish, ...beobachtung };
}

export function beendeAktiveCalls(state) {
  for (const call of state.calls.filter((eintrag) => eintrag.status === "active")) ops.endCallRecord(state, call.id, "completed");
}

export async function beendeSchleifen(state, anbieter) {
  beendeAktiveCalls(state);
  await waitUntil(() => anbieter.offen === 0, WARTE);
  await ruhe(RUHE_TAKTE);
}

export async function mitAnbieter({ state, anbieter }, run) {
  await withFetch(anbieter.fetch, async () => {
    try {
      await run();
    } catch (err) {
      beendeAktiveCalls(state);
      await ruhe(RUHE_TAKTE);
      throw err;
    }
  });
}

const TTS_PFAD = /^\/v1\/text-to-speech\/([^/?]+)\/stream/;
const TTS_BYTES = Buffer.from("ID3-attrappe");

function beantworteTts(attrappe, { req, res, treffer }) {
  attrappe.ttsStimmen.push(decodeURIComponent(treffer[1]));
  req.resume();
  res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
  res.end(TTS_BYTES);
}

function beantworteConversation(attrappe, { req, res }) {
  attrappe.anfragen.push({ method: req.method, url: req.url, atMs: Date.now() });
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  res.end(JSON.stringify(req.method === "DELETE" ? {} : attrappe.antwort));
}

export async function starteAnbieterAttrappe() {
  const attrappe = { anfragen: [], ttsStimmen: [], antwort: CONVERSATION_IN_PROGRESS };
  attrappe.setzeAntwort = (conversation) => {
    attrappe.antwort = conversation;
  };
  const server = http.createServer((req, res) => {
    const treffer = req.url.match(TTS_PFAD);
    if (treffer) return beantworteTts(attrappe, { req, res, treffer });
    return beantworteConversation(attrappe, { req, res });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  attrappe.url = `http://127.0.0.1:${server.address().port}`;
  attrappe.gets = () => attrappe.anfragen.filter((anfrage) => anfrage.method === "GET" && anfrage.url.includes(CONV_ID));
  attrappe.deletes = () => attrappe.anfragen.filter((anfrage) => anfrage.method === "DELETE");
  attrappe.close = () => new Promise((resolve) => server.close(resolve));
  return attrappe;
}
