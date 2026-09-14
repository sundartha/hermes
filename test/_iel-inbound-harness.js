// IEL-B4/B5: gemeinsame Offline-Bank fuer ueberbrueckte Inbound-Calls (Kostenprofil
// telnyx_inbound_el_convai) - reine Verschiebung aus test/iel-b4-nachlauf.test.js, damit
// IEL-B5 dieselben Bausteine nutzt statt einer zweiten Kopie (G5/S2). Kein *.test.js ->
// wird nicht als Test gefahren (Praezedenz test/_outbound-harness.js).
//
// Offline, kein Netz, kein Server: Anbieter-Attrappe ueber withFetch, der Store reicht an
// die ECHTEN state-ops-Mutatoren durch (storeOpsFacade), finishCall ist die ECHTE
// makeCallFinish-Instanz (Purge greift, Buchung wird ueber voiceMinutesOf mitgeschrieben).
import { voiceMinutesOf } from "../src/billing/metering.js";
import { KOSTENPROFIL } from "../src/billing/kostenarten.js";
import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { billThunk, terminateAndBillCall } from "../src/telephony/call-termination.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { CONVERSATION_DONE_WITH_ANALYSIS } from "./fixtures/elevenlabs-conversations.js";
import { storeOpsFacade, waitUntil, withFetch } from "./helpers.js";

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

export const isoVor = (sekunden) => new Date(Date.now() - sekunden * MS_PER_SECOND).toISOString();
export const ruhe = (takte) => new Promise((resolve) => setTimeout(resolve, takte * POLL_MS));
export const okAntwort = (conversation) => ({ ok: true, status: HTTP_OK, json: async () => conversation });
export const fehlerAntwort = (envelope) => ({ ok: false, status: envelope.httpStatus, json: async () => envelope.body });

// ---- Build: Datensaetze ------------------------------------------------------------------

// IEL-B6: ein WARTENDER Inbound-EL-Call (noch nicht gebunden) mit echter Store-Herkunft.
// answeredAt stammt in Produktion aus /voice/incoming (unser Telnyx-Bein), twilioSid aus
// req.body.CallSid.
export function seedWartenderElCall(state, { answeredVorS }) {
  const call = ops.createCall(state, {
    direction: "inbound",
    from: INBOUND_FROM,
    to: INBOUND_TO,
    twilioSid: TRAEGER_SID,
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  call.startedAt = isoVor(answeredVorS);
  call.answeredAt = call.startedAt;
  ops.recordCostProfile(state, call.id, KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI);
  return call;
}

// Ein ueberbrueckter Inbound-Call (GEBUNDEN) - derselbe Seed, danach gebunden.
export function seedInboundElCall(state, { answeredVorS, nachlaufVorS = null }) {
  const call = seedWartenderElCall(state, { answeredVorS });
  ops.bindInboundElConversation(state, call.id, { conversationId: CONV_ID, nowIso: new Date().toISOString() });
  if (nachlaufVorS !== null) ops.markInboundElNachlaufStarted(state, call.id, isoVor(nachlaufVorS));
  return call;
}

// ---- Build: Anbieter-Attrappe ------------------------------------------------------------
// antwort() liefert je GET die Antwort (ueberschreibbar im Lauf); offen/maxOffen zaehlen
// gleichzeitig laufende Abrufe (Single-Flight-Beleg).
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

// ---- Build: Harness (echter finishCall, echter Terminierungspfad) ------------------------
export function baueStore(state, beobachtung) {
  return {
    ...storeOpsFacade(state),
    // Wie die echte Fassade (json.js/pg.js): der Call, nicht das {call, changed}-Paar.
    setCallEndedAt: (id, status, iso) => ops.setCallEndedAt(state, id, status, iso).call,
    markInboundElNachlaufStarted: (id, iso) => ops.markInboundElNachlaufStarted(state, id, iso),
    // IEL-B5: die Voice-Route stempelt answered/in-progress.
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

// IEL-B5: store und callFinish reisen mit, damit Lifecycle und Routen auf DERSELBEN Instanz
// bauen wie der Ergebnisweg (INV-7).
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

// Beendet noch laufende Schleifen VOR dem Ende von withFetch (sonst ginge ein spaeterer
// Takt gegen das echte Netz): Calls terminal, laufende Abrufe abwarten, Folgetakte auslaufen.
export function beendeAktiveCalls(state) {
  for (const call of state.calls.filter((eintrag) => eintrag.status === "active")) ops.endCallRecord(state, call.id, "completed");
}

export async function beendeSchleifen(state, anbieter) {
  beendeAktiveCalls(state);
  await waitUntil(() => anbieter.offen === 0, WARTE);
  await ruhe(RUHE_TAKTE);
}

// Faehrt run() mit der Attrappe als fetch. Scheitert eine Zusicherung MITTEN im Lauf, liefen
// noch armierte Schleifen nach withFetch gegen das echte Netz weiter und der Testprozess
// endete nie - der Fehlerpfad beendet deshalb zuerst alle aktiven Calls (ein festgehaltener
// Abruf haelt keinen Timer, er blockiert den Prozess nicht).
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
