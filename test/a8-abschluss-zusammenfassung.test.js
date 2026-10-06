import assert from "node:assert/strict";
import { test } from "node:test";
import { waitUntil } from "./conversation-driver-contract.js";
import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import { terminateAndBillCall } from "../src/telephony/call-termination.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { withFetch } from "./helpers.js";
import { CONVERSATION_DONE_WITH_DATA_COLLECTION } from "./fixtures/elevenlabs-conversations.js";

const APPOINTMENT_DATE = "March 3";
const APPOINTMENT_TIME = "2:30 PM";

function ownValuesOf(mapped) {
  return Object.values(mapped).flatMap((value) => (Array.isArray(value) ? value : [value]));
}

function makeCapturingStore(conversationId) {
  const call = {
    id: `call_${conversationId}`,
    status: "active",
    elevenlabsConversationId: conversationId,
    answeredAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
  const captured = { transcript: [], summary: undefined };
  const store = {
    getCall: () => call,
    load: () => ({ calls: [call] }),
    addTranscript: (_id, role, message) => captured.transcript.push({ role, message }),
    recordProviderCallResult: (_id, { summary, objectiveAchieved }) => {
      captured.summary = summary;
      call.objectiveAchieved = objectiveAchieved;
    },
    recordProviderCollectedFields: (_id, { appointmentDate, appointmentTime, amount, currency }) => {
      call.appointmentDate = appointmentDate;
      call.appointmentTime = appointmentTime;
      call.amount = amount;
      call.currency = currency;
    },
    recordCalleeConfirmedTimezone: () => {},
    recordSipCallId: () => {},
    recordElDetectorCounts: () => {},
    recordFromRegistrationSource: () => {},
    recordActualSender: () => {},
    trueUpAnsweredAt: () => {},
    recordAnsweredUnclearReason: () => {},
    recordFailureReason: () => {},
    endCallRecord: (_id, status) => {
      call.status = status;
      call.endedAt = new Date().toISOString();
      return call;
    },
  };
  return { call, store, captured };
}

test("[abgenommen D1] Datum, Uhrzeit und Betrag kommen als eigene Angaben im Ergebnis an", async () => {
  const { call, store, captured } = makeCapturingStore(CONVERSATION_DONE_WITH_DATA_COLLECTION.conversation_id);
  let billed = false;
  const el = makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({ elevenLabsOutbound: { apiKey: "test-key", apiBase: "https://el.test" } }),
    terminateAndBillCall,
    billThunk: () => () => {
      billed = true;
    },
    finishCall: () => {},
  });

  const HTTP_OK = 200;
  await withFetch(
    async (_url, init) =>
      init.method === "GET"
        ? { ok: true, status: HTTP_OK, json: async () => CONVERSATION_DONE_WITH_DATA_COLLECTION }
        : { ok: true, status: HTTP_OK },
    async () => {
      el.rearmActiveConversationPolls();
      await waitUntil(() => billed);
    },
  );

  assert.equal(
    captured.summary,
    CONVERSATION_DONE_WITH_DATA_COLLECTION.analysis.transcript_summary,
    "die Zusammenfassung bleibt der unveraenderte Anbieter-Freitext",
  );

  const ownValues = ownValuesOf({
    appointment_date: call.appointmentDate,
    appointment_time: call.appointmentTime,
    amount: call.amount,
    currency: call.currency,
  });
  const required = [
    ["Datum", APPOINTMENT_DATE],
    ["Uhrzeit", APPOINTMENT_TIME],
    ["Betrag", "60"],
    ["Waehrung", "USD"],
  ];
  for (const [label, value] of required) {
    assert.ok(
      ownValues.includes(value),
      `${label} ("${value}") ist im Ergebnis als eigene Angabe lesbar (call.appointmentDate/` +
        "appointmentTime/amount/currency) - additiv neben result_summary, kein Ersatz dafuer",
    );
  }
});
