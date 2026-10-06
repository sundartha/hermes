import assert from "node:assert/strict";
import { test } from "node:test";

import { collectedFieldsOf, makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import { terminateAndBillCall } from "../src/telephony/call-termination.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import {
  createCall,
  makeDefaultState,
  recordCalleeConfirmedTimezone,
  recordProviderCollectedFields,
} from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { waitUntil, withFetch } from "./helpers.js";
import { CONVERSATION_DONE_WITH_DATA_COLLECTION } from "./fixtures/elevenlabs-conversations.js";
import { makePgTestStore } from "./pg-helpers.js";
import { makePgStore } from "../src/store/pg.js";

const ACCOUNT = { apiKey: "test-key", apiBase: "https://el.test" };
const HTTP_OK = 200;

test("collectedFieldsOf: alle fuenf Angaben kommen woertlich an, amount als String (Anbieter liefert es als Zahl)", () => {
  const collected = collectedFieldsOf(CONVERSATION_DONE_WITH_DATA_COLLECTION);

  assert.equal(collected.appointmentDate, "March 3");
  assert.equal(collected.appointmentTime, "2:30 PM");
  assert.equal(collected.amount, "60", "amount kommt vom Anbieter als Zahl (type:number), reist hier als String");
  assert.equal(collected.currency, "USD");
  assert.equal(collected.confirmedTimezone, "Eastern time");
});

test("collectedFieldsOf: FEHLT data_collection_results ganz (Normalfall, s. Owner-Auflage), sind alle fuenf null - kein Fehler, kein Platzhalter", () => {
  const collected = collectedFieldsOf({ analysis: { call_successful: "success", transcript_summary: "x" } });

  assert.deepEqual(collected, {
    appointmentDate: null,
    appointmentTime: null,
    amount: null,
    currency: null,
    confirmedTimezone: null,
  });
});

test("collectedFieldsOf: analysis:null (kein Gespraech ausgewertet) liefert ebenfalls alle fuenf null, ohne zu werfen", () => {
  const collected = collectedFieldsOf({ analysis: null });
  assert.deepEqual(collected, {
    appointmentDate: null,
    appointmentTime: null,
    amount: null,
    currency: null,
    confirmedTimezone: null,
  });
});

test("collectedFieldsOf: FEHLT nur EINE Angabe im Gespraech (kein Preis verhandelt), bleiben die uebrigen vier unberuehrt - der haeufige Teil-Fall", () => {
  const collected = collectedFieldsOf({
    analysis: {
      data_collection_results: {
        appointment_date: { data_collection_id: "appointment_date", value: "March 3", rationale: "x" },
        appointment_time: { data_collection_id: "appointment_time", value: "2:30 PM", rationale: "x" },
      },
    },
  });

  assert.equal(collected.appointmentDate, "March 3");
  assert.equal(collected.appointmentTime, "2:30 PM");
  assert.equal(collected.amount, null);
  assert.equal(collected.currency, null);
  assert.equal(collected.confirmedTimezone, null);
});

test("collectedFieldsOf: eine leere Zeichenkette (Anbieter hat das Feld erwaehnt, aber leer gelassen) zaehlt wie fehlend, nicht wie ein leerer Angaben-Wert", () => {
  const collected = collectedFieldsOf({
    analysis: {
      data_collection_results: {
        amount: { data_collection_id: "amount", value: "", rationale: "x" },
        currency: { data_collection_id: "currency", value: "", rationale: "x" },
      },
    },
  });

  assert.equal(collected.amount, null);
  assert.equal(collected.currency, null);
});

function freshCall(state) {
  return createCall(state, {
    direction: "outbound",
    from: "+491700000000",
    to: "+491701111111",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
}

test("recordProviderCollectedFields: schreibt alle vier Angaben additiv, ohne summary/objectiveAchieved anzufassen", () => {
  const state = makeDefaultState();
  const call = freshCall(state);
  call.summary = "Bestehende Zusammenfassung.";
  call.objectiveAchieved = true;

  const { changed } = recordProviderCollectedFields(state, call.id, {
    appointmentDate: "March 3",
    appointmentTime: "2:30 PM",
    amount: "60",
    currency: "USD",
  });

  assert.equal(changed, true);
  assert.equal(call.appointmentDate, "March 3");
  assert.equal(call.appointmentTime, "2:30 PM");
  assert.equal(call.amount, "60");
  assert.equal(call.currency, "USD");
  assert.equal(call.summary, "Bestehende Zusammenfassung.", "der Freitext bleibt unveraendert (additiv, kein Ersatz)");
  assert.equal(call.objectiveAchieved, true, "objectiveAchieved bleibt unveraendert");
});

test("recordProviderCollectedFields: fehlende Angaben (undefined) landen als null, kein Platzhaltertext", () => {
  const state = makeDefaultState();
  const call = freshCall(state);

  recordProviderCollectedFields(state, call.id, {
    appointmentDate: "March 3",
    appointmentTime: undefined,
    amount: undefined,
    currency: undefined,
  });

  assert.equal(call.appointmentDate, "March 3");
  assert.equal(call.appointmentTime, null);
  assert.equal(call.amount, null);
  assert.equal(call.currency, null);
});

test("recordCalleeConfirmedTimezone: Wert, Herkunft und Zeitstempel werden gemeinsam gesetzt", () => {
  const state = makeDefaultState();
  const call = freshCall(state);
  assert.equal(call.calleeConfirmedTimezone, null, "Vorbedingung: frischer Call ohne bestaetigte Zone");

  const confirmedAt = "2026-08-16T10:00:00.000Z";
  const { changed } = recordCalleeConfirmedTimezone(state, call.id, {
    timezone: "Eastern time",
    origin: "elevenlabs_data_collection",
    confirmedAt,
  });

  assert.equal(changed, true);
  assert.equal(call.calleeConfirmedTimezone, "Eastern time");
  assert.equal(call.calleeConfirmedTimezoneOrigin, "elevenlabs_data_collection");
  assert.equal(call.calleeConfirmedTimezoneAt, confirmedAt);
});

test("recordCalleeConfirmedTimezone: UEBERSCHREIBBAR (Eigentuemer-Auflage) - ein spaeterer bestaetigter Wert ersetzt einen frueheren, kein set-once", () => {
  const state = makeDefaultState();
  const call = freshCall(state);

  recordCalleeConfirmedTimezone(state, call.id, {
    timezone: "Eastern time",
    origin: "elevenlabs_data_collection",
    confirmedAt: "2026-08-16T10:00:00.000Z",
  });
  recordCalleeConfirmedTimezone(state, call.id, {
    timezone: "Pacific time",
    origin: "elevenlabs_data_collection",
    confirmedAt: "2026-08-16T10:05:00.000Z",
  });

  assert.equal(call.calleeConfirmedTimezone, "Pacific time", "der zweite, spaetere Wert gewinnt");
  assert.equal(call.calleeConfirmedTimezoneAt, "2026-08-16T10:05:00.000Z");
});

function makeCapturingStore({ id, elevenlabsConversationId, answeredAt }) {
  const call = {
    id,
    status: "active",
    elevenlabsConversationId,
    answeredAt,
    startedAt: answeredAt,
    endedAt: null,
  };
  const captured = {
    transcript: [],
    summary: undefined,
    objectiveAchieved: undefined,
    collectedFields: undefined,
    confirmedTimezone: undefined,
  };
  const store = {
    getCall: () => call,
    load: () => ({ calls: [call] }),
    addTranscript: (_id, role, message) => captured.transcript.push({ role, message }),
    recordProviderCallResult: (_id, { summary, objectiveAchieved }) => {
      captured.summary = summary;
      captured.objectiveAchieved = objectiveAchieved;
    },
    recordProviderCollectedFields: (_id, fields) => {
      captured.collectedFields = fields;
    },
    recordCalleeConfirmedTimezone: (_id, confirmed) => {
      captured.confirmedTimezone = confirmed;
    },
    recordSipCallId: () => {},
    recordElDetectorCounts: () => {},
    recordFromRegistrationSource: () => {},
    recordActualSender: () => {},
    trueUpAnsweredAt: (_id, answeredAtIso) => {
      call._answeredAtIso = answeredAtIso;
    },
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

async function pollFixtureConversation(fixture) {
  const { call, store, captured } = makeCapturingStore({
    id: `call_${fixture.conversation_id}`,
    elevenlabsConversationId: fixture.conversation_id,
    answeredAt: new Date().toISOString(),
  });
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
  return { call, captured };
}

test("Ende-zu-Ende: ein abgeschlossenes Gespraech mit Data-Collection-Ergebnis liefert die vier Angaben additiv NEBEN Transkript und Zusammenfassung, unveraendert", async () => {
  const { captured } = await pollFixtureConversation(CONVERSATION_DONE_WITH_DATA_COLLECTION);

  assert.deepEqual(captured.transcript, [
    { role: "agent", message: "So March 3rd, 2:30 PM, sixty dollars. Thank you, goodbye." },
  ]);
  assert.equal(
    captured.summary,
    "Booked the brake pad replacement for March 3 at 2:30 PM for $60.00.",
    "der Freitext bleibt der unveraenderte Anbieter-Text",
  );

  assert.deepEqual(captured.collectedFields, {
    appointmentDate: "March 3",
    appointmentTime: "2:30 PM",
    amount: "60",
    currency: "USD",
    confirmedTimezone: "Eastern time",
  });

  assert.equal(captured.confirmedTimezone.timezone, "Eastern time");
  assert.equal(captured.confirmedTimezone.origin, "elevenlabs_data_collection");
  assert.ok(captured.confirmedTimezone.confirmedAt, "ein Zeitstempel muss mitreisen");
  assert.ok(
    !Number.isNaN(Date.parse(captured.confirmedTimezone.confirmedAt)),
    "der Zeitstempel muss ein gueltiges ISO-Datum sein",
  );
});

test("Ende-zu-Ende: KEIN Feld erhoben (kein Termin, kein Preis, keine bestaetigte Zone) - die vier Angaben bleiben null, und recordCalleeConfirmedTimezone wird gar nicht erst aufgerufen", async () => {
  const fixtureOhneDataCollection = {
    conversation_id: "conv_ohne_data_collection",
    status: "done",
    transcript: [{ role: "agent", message: "Sorry, wrong number. Goodbye." }],
    analysis: {
      call_successful: "failure",
      transcript_summary: "Reached the wrong person, no appointment or price was discussed.",
    },
    metadata: { call_duration_secs: 12, termination_reason: "Client disconnected: 1000", error: null },
  };

  const { captured } = await pollFixtureConversation(fixtureOhneDataCollection);

  assert.deepEqual(captured.collectedFields, {
    appointmentDate: null,
    appointmentTime: null,
    amount: null,
    currency: null,
    confirmedTimezone: null,
  });
  assert.equal(
    captured.confirmedTimezone,
    undefined,
    "ohne bestaetigten Wert wird recordCalleeConfirmedTimezone NICHT aufgerufen - nur bestaetigte Werte werden gespeichert",
  );
});

async function reopen(db) {
  const runner = {
    withClient: (fn) =>
      fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

test("pg-Backend: die vier Angaben UND die bestaetigte Zeitzone (Wert+Herkunft+Zeitstempel) ueberleben eine Re-Hydrierung", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({
    direction: "outbound",
    from: "+491700000000",
    to: "+491701111111",
    tenantId: BOOTSTRAP_TENANT_ID,
  });

  store.recordProviderCollectedFields(call.id, {
    appointmentDate: "March 3",
    appointmentTime: "2:30 PM",
    amount: "60",
    currency: "USD",
  });
  store.recordCalleeConfirmedTimezone(call.id, {
    timezone: "Eastern time",
    origin: "elevenlabs_data_collection",
    confirmedAt: "2026-08-16T10:00:00.000Z",
  });
  await store.save();

  const reopened = await reopen(db);
  const got = reopened.getCall(call.id);

  assert.ok(got, "Call ueberlebt die Re-Hydrierung");
  assert.equal(got.appointmentDate, "March 3");
  assert.equal(got.appointmentTime, "2:30 PM");
  assert.equal(got.amount, "60");
  assert.equal(got.currency, "USD");
  assert.equal(got.calleeConfirmedTimezone, "Eastern time");
  assert.equal(got.calleeConfirmedTimezoneOrigin, "elevenlabs_data_collection");
  assert.equal(got.calleeConfirmedTimezoneAt, "2026-08-16T10:00:00.000Z");
});

test("pg-Backend: ein frischer Call ohne Data-Collection-Ergebnis hydriert alle sieben Felder als null (Bestand bleibt byte-identisch)", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({
    direction: "outbound",
    from: "+491700000000",
    to: "+491701111111",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  await store.save();

  const reopened = await reopen(db);
  const got = reopened.getCall(call.id);

  for (const field of [
    "appointmentDate",
    "appointmentTime",
    "amount",
    "currency",
    "calleeConfirmedTimezone",
    "calleeConfirmedTimezoneOrigin",
    "calleeConfirmedTimezoneAt",
  ]) {
    assert.equal(got[field], null, `${field} muss ohne Ergebnis null hydrieren`);
  }
});
