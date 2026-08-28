// OUTBOUND-E2 (F1): die GELD-Regression. Harness (storeOpsFacade/withFetch/waitUntil) geteilt
// mit test/el-geldpfad-s1.test.js ueber test/helpers.js (G5: eine Kopie hatte den naechsten
// Store-Methoden-Zuwachs bereits in 5 weiteren Test-Attrappen erzwungen, s. Review-Befund
// E2-S2-1). Der Store ist KEIN Handnachbau, sondern reicht jeden Aufruf an die ECHTEN
// state-ops-Mutatoren durch, damit voiceMinutesOf (billing/metering.js) gegen denselben
// Datensatz rechnet wie in Produktion.
//
// Kern der Etappe (Owner-Auflage PM-14, Geld-Pfad unberuehrt): ein abgelehnter Anruf laeuft
// schon heute ueber clearAnchor -> answeredAt=null -> 0 gebuchte Minuten - E2 aendert NUR das
// Label. Ein Anbieterfehler bei bereits laufender Dauer (42 s) darf den Anker NICHT loeschen
// (Fall 2 unten ist der Beweis, dass genau das nicht passiert).
//
// Testnamen tragen bewusst KEINE Katalog-/Abnahme-Kennung am Namensanfang (Lehre
// catalog-id-prefix-misroutes-tests).
import { test } from "node:test";
import assert from "node:assert/strict";

import { voiceMinutesOf } from "../src/billing/metering.js";
import { answeredAnchorOutcome, makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { terminateAndBillCall } from "../src/telephony/call-termination.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { CONVERSATION_FAILED_UNVERIFIED_ORIGINATION } from "./fixtures/elevenlabs-conversations.js";
import { storeOpsFacade, waitUntil, withFetch } from "./helpers.js";

const ACCOUNT = { apiKey: "test-key", apiBase: "https://el.test" };
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const CALL_LAUFZEIT_S = 5; // seit answeredAt vergangen - deutlich unter jedem Deckel, kein Zombie
const KONSTRUIERTE_DAUER_S = 42;
const ERWARTETE_MINUTEN_BEI_42S = 1;
// Deutlich ueber dem Anbieter-Deckel (ELEVENLABS_PROVIDER_MAX_DURATION_S=600s): macht
// classifyCallTime(...).expired wahr, OHNE dass der Fetch-Mock ueberhaupt gebraucht wird
// (die Zeit-Obergrenze wird VOR dem Ergebnisabruf geprueft, s. pollConversationResult).
const ZOMBIE_LAUFZEIT_S = 700;

function seedActiveCall() {
  const state = ops.makeDefaultState();
  const call = ops.createCall(state, {
    direction: "outbound",
    from: "+491700000000",
    to: "+491701111111",
    goal: "Termin vereinbaren",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  call.elevenlabsConversationId = CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.conversation_id;
  const anker = new Date(Date.now() - CALL_LAUFZEIT_S * MS_PER_SECOND).toISOString();
  call.startedAt = anker;
  call.answeredAt = anker; // der Verbindungsstempel des Anrufstarts (markAnswered)
  return { state, call, store: storeOpsFacade(state) };
}

// EIN Poll-Takt gegen genau EINEN Gespraechs-Datensatz (Fixture) - der Anbieter antwortet
// sofort mit dem uebergebenen Datensatz, egal welche Kennung angefragt wird.
async function pollFixtureConversation(fixture) {
  const { call, store } = seedActiveCall();
  let billed = false;
  const el = makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({ elevenLabsOutbound: ACCOUNT }),
    terminateAndBillCall,
    billThunk: () => () => {
      billed = true;
    },
    finishCall: () => {},
  });
  await withFetch(
    async (_url, init) =>
      init.method === "GET" ? { ok: true, status: HTTP_OK, json: async () => fixture } : { ok: true, status: HTTP_OK },
    async () => {
      el.rearmActiveConversationPolls();
      await waitUntil(() => billed);
    },
  );
  return call;
}

test("gemessener 403-Fall (Dauer 0): KEIN Buchungsanker, 0 gebuchte Minuten - identisch zum Bestand, NUR das Label ist neu", async () => {
  const call = await pollFixtureConversation(CONVERSATION_FAILED_UNVERIFIED_ORIGINATION);

  assert.equal(call.answeredAt, null, "kein Buchungsanker ohne Anbieter-Dauer");
  assert.equal(voiceMinutesOf(call), 0, "ohne Anker werden 0 Minuten gebucht - unveraendert");
  assert.equal(call.answeredUnclearReason, "provider_rejected_before_answer");
  assert.equal(call.failureReason, "not-placed:invite-403-D51");
});

test("Anbieterfehler bei 42 Sekunden gelaufener Dauer: der Anker BLEIBT, die Minuten bleiben, es gibt KEINEN Fehlergrund", async () => {
  // KONSTRUIERT auf der gemessenen Fehler-Struktur (27.08.2026): dieselbe metadata.error,
  // aber mit einer brauchbaren Anbieter-Dauer - das Gespraech ist zustande gekommen und
  // wird bezahlt, es traegt keinen "nie zustande gekommen"-Grund (PM-14).
  const fixtureMit42s = {
    ...CONVERSATION_FAILED_UNVERIFIED_ORIGINATION,
    metadata: {
      ...CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.metadata,
      call_duration_secs: KONSTRUIERTE_DAUER_S,
    },
  };
  const call = await pollFixtureConversation(fixtureMit42s);

  assert.notEqual(call.answeredAt, null, "eine brauchbare Anbieter-Dauer MUSS einen Anker setzen, auch bei metadata.error");
  const erwarteteAnkerMs = Date.parse(call.endedAt) - KONSTRUIERTE_DAUER_S * MS_PER_SECOND;
  assert.equal(Date.parse(call.answeredAt), erwarteteAnkerMs, "der Anker muss aus endedAt minus der Anbieter-Dauer gebildet sein");
  assert.equal(voiceMinutesOf(call), ERWARTETE_MINUTEN_BEI_42S, "42 Sekunden werden aufgerundet auf 1 Minute gebucht - unveraendert");
  assert.equal(call.failureReason, null, "eine bezahlte, zustande gekommene Konversation traegt keinen Nie-zustande-gekommen-Grund");
  assert.equal(call.answeredUnclearReason, null, "kein unklarer Grund, wenn die Dauer brauchbar war");
});

test("laufendes Gespraech mit gesetztem Anbieterfehler: keepAnchor, Grund unveraendert", () => {
  const conversation = {
    status: "in-progress",
    metadata: { call_duration_secs: 0, error: CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.metadata.error },
  };
  const anchor = answeredAnchorOutcome(new Date().toISOString(), conversation);

  assert.deepEqual(anchor, {
    answeredAtIso: null,
    unclearReason: "call_duration_secs_unknown_conversation_in_progress",
    keepExistingAnchor: true,
  });
});

test("echte Nicht-Rufannahme (Dauer 0, kein Anbieterfehler): byte-identisch zum Bestand", async () => {
  const fixtureOhneFehler = {
    ...CONVERSATION_FAILED_UNVERIFIED_ORIGINATION,
    metadata: { ...CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.metadata, error: null },
  };
  const call = await pollFixtureConversation(fixtureOhneFehler);

  assert.equal(call.answeredAt, null);
  assert.equal(voiceMinutesOf(call), 0);
  assert.equal(call.answeredUnclearReason, "call_duration_secs_zero_not_answered");
  assert.equal(call.failureReason, null, "ohne Anbieterfehler gibt es keinen Grund zu erfinden");
  assert.notEqual(
    call.answeredUnclearReason,
    "provider_rejected_before_answer",
    "eine echte Nichtannahme und ein Anbieterfehler duerfen NIE dasselbe Label tragen",
  );
});

// Review-Befund S1-1 (Runde 3): finishExpiredPoll persistiert seit dieser Etappe erstmals
// POLL_TIMEOUT_REASON am Call-Record - ungeprueft war das neues Verhalten ohne jede
// Assertion (Gegenprobe: failureReason durch null ersetzt -> voller Regressionslauf bleibt
// gruen). Die Zeit-Obergrenze wird VOR dem Ergebnisabruf geprueft (pollConversationResult),
// der Fetch-Mock hier antwortet deshalb nie inhaltlich - er darf nur nicht fehlen.
test("Poll-Obergrenze ueberschritten (Zombie-Anruf): failureReason = result-unknown:poll-timeout", async () => {
  const { call, store } = seedActiveCall();
  call.startedAt = new Date(Date.now() - ZOMBIE_LAUFZEIT_S * MS_PER_SECOND).toISOString();
  call.answeredAt = call.startedAt;
  let billed = false;
  const el = makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({ elevenLabsOutbound: ACCOUNT }),
    terminateAndBillCall,
    billThunk: () => () => {
      billed = true;
    },
    finishCall: () => {},
  });
  await withFetch(
    async () => {
      throw new Error("darf nicht aufgerufen werden: die Zeit-Obergrenze entscheidet vor dem Fetch");
    },
    async () => {
      el.rearmActiveConversationPolls();
      await waitUntil(() => billed);
    },
  );

  assert.equal(call.failureReason, "result-unknown:poll-timeout");
});

// Review-Befund S1-1 (Runde 3): finishOnPermanentError persistiert
// pollProviderErrorReason(deps.providerStatus) - ungeprueft, ob der Anbieter-Status
// tatsaechlich am Call-Record landet. PERMANENT_FETCH_STATUS (401/404) verlangt
// PERMANENT_ERROR_STREAK_LIMIT (3) Fehlschlaege IN FOLGE, bevor der Poll aufgibt -
// rearmActiveConversationPolls ruft pollConversationResult direkt (kein echter Timer noetig),
// dreimaliger Aufruf reicht darum, um die Schwelle zu erreichen.
test("dauerhafter Abruf-Fehler (HTTP 404, 3x in Folge): failureReason traegt den Anbieter-Status", async () => {
  const { call, store } = seedActiveCall();
  let billed = false;
  const el = makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({ elevenLabsOutbound: ACCOUNT }),
    terminateAndBillCall,
    billThunk: () => () => {
      billed = true;
    },
    finishCall: () => {},
  });
  await withFetch(
    async (_url, init) =>
      init.method === "GET" ? { ok: false, status: HTTP_NOT_FOUND, json: async () => ({}) } : { ok: true, status: HTTP_OK },
    async () => {
      el.rearmActiveConversationPolls();
      el.rearmActiveConversationPolls();
      el.rearmActiveConversationPolls();
      await waitUntil(() => billed);
    },
  );

  assert.equal(call.failureReason, "result-unknown:poll-provider-404");
});
