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
const CALL_LAUFZEIT_S = 5;
const KONSTRUIERTE_DAUER_S = 42;
const ERWARTETE_MINUTEN_BEI_42S = 1;
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
  call.answeredAt = anker;
  return { state, call, store: storeOpsFacade(state) };
}

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
