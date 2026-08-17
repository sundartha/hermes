// Der naechste Schritt eines ElevenLabs-Gespraechs wird ein Action Item - und
// list_action_items liefert ihn.
//
// LAGE VOR DIESEM PAKET: die Feld-Kennung "next_steps" ist am Agenten deklariert
// (elevenlabs/agent_configs/outbound-agent.template.json, platform_settings.
// data_collection) und wurde vom Anbieter bei jedem Gespraech mitgeliefert - aber von
// keinem Leser abgeholt. Auf dem ElevenLabs-Weg rief deshalb NICHTS store.addActionItem
// (der Bestandsweg tut es in claude.js), und list_action_items (src/mcp-tools.js) blieb
// dauerhaft leer. In src/telephony/call-finish.js stand im selben Zweig ein hart
// gesetztes actionItems: [], sodass auch die Zusammenfassungs-SMS nichts nannte.
//
// GEPRUEFT WIRD auf zwei Ebenen, jeweils gegen den ECHTEN Weg:
//   1) Poll-Weg Ende-zu-Ende (makeElevenLabsOutbound#rearmActiveConversationPolls ->
//      pollConversationResult -> finishFromConversation -> persistProviderResult) gegen
//      einen Store aus den ECHTEN state-ops (kein Attrappen-Store, damit addActionItem/
//      callActionItems wirklich laufen), Attrappen-fetch, kein Netz, kein Backend.
//   2) die Ausgabe des echten MCP-Werkzeugs list_action_items ueber ein Gateway-Mock,
//      das genau den so entstandenen Store-Zustand als /api/state ausliefert. Muster
//      test/mcp-tools.test.js.
//
// Testnamen tragen bewusst KEINE Katalog-Kennung am Namensanfang (kein "ABNAHME-",
// "GAP-", "PROMPT-") - sonst landet die Datei im falschen Testlauf (Lehre
// catalog-id-prefix-misroutes-tests).
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import { registerTools } from "../src/mcp-tools.js";
import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import { terminateAndBillCall } from "../src/telephony/call-termination.js";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const ACCOUNT = { apiKey: "test-key", apiBase: "https://el.test" };
const HTTP_OK = 200;
const WAIT_TIMEOUT_MS = 500;
const WAIT_POLL_INTERVAL_MS = 5;

const NEXT_STEP_TEXT = "Bring the vehicle registration to the appointment on March 3.";
const NEXT_STEP_WITHOUT_APPOINTMENT = "Send over the damage photos by email this week.";

// ---- Fixtures: Anbieter-Antworten in der Form, die collectedValue liest ----------------
// Form je Eintrag = DataCollectionResultCommonModel (data_collection_id/value), dieselbe
// wie in test/fixtures/elevenlabs-conversations.js. Hier bewusst LOKAL statt die dortige
// gemeinsame Fixture zu erweitern: an ihr haengen deepEqual-Erwartungen anderer Tests.
function collected(entries) {
  return Object.fromEntries(
    Object.entries(entries).map(([id, value]) => [id, { data_collection_id: id, value }]),
  );
}

function conversationWith(dataCollectionResults, conversationId) {
  return {
    conversation_id: conversationId,
    status: "done",
    transcript: [{ role: "agent", message: "Understood, see you then. Goodbye." }],
    analysis: {
      call_successful: "success",
      transcript_summary: "Agreed on the appointment and the paperwork to bring.",
      data_collection_results: dataCollectionResults,
    },
    metadata: { call_duration_secs: 42, termination_reason: "Client disconnected: 1000", error: null },
  };
}

const CONVERSATION_MIT_TERMIN = conversationWith(
  collected({
    appointment_date: "March 3",
    appointment_time: "2:30 PM",
    next_steps: NEXT_STEP_TEXT,
  }),
  "conv_next_steps_mit_termin",
);

const CONVERSATION_OHNE_TERMIN = conversationWith(
  collected({ next_steps: NEXT_STEP_WITHOUT_APPOINTMENT }),
  "conv_next_steps_ohne_termin",
);

const CONVERSATION_OHNE_NAECHSTEN_SCHRITT = conversationWith(
  collected({ appointment_date: "March 3" }),
  "conv_ohne_next_steps",
);

// ---- Ein Store aus den ECHTEN state-ops --------------------------------------------------
// Nur die Mutatoren, die dieser Weg anfasst - aber jeder davon der echte, damit
// addActionItem wirklich entdoppelt und callActionItems wirklich liest.
function makeStateStore() {
  const state = ops.makeDefaultState();
  const call = ops.createCall(state, {
    direction: "outbound",
    from: "+10000000000",
    to: "+10000000001",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  call.status = "active";
  call.answeredAt = new Date().toISOString();
  call.elevenlabsConversationId = null;
  return {
    state,
    call,
    store: {
      load: () => state,
      getCall: (id) => ops.getCall(state, id),
      addTranscript: (id, role, text) => ops.addTranscript(state, id, role, text),
      addActionItem: (id, text, type) => ops.addActionItem(state, id, text, type),
      callActionItems: (id) => ops.callActionItems(state, id),
      endCallRecord: (id, status) => ops.endCallRecord(state, id, status).call,
      trueUpAnsweredAt: (id, iso) => ops.trueUpAnsweredAt(state, id, iso),
      recordProviderCallResult: (id, result) => ops.recordProviderCallResult(state, id, result),
      recordProviderCollectedFields: (id, fields) => ops.recordProviderCollectedFields(state, id, fields),
      recordCalleeConfirmedTimezone: (id, confirmed) => ops.recordCalleeConfirmedTimezone(state, id, confirmed),
      recordAnsweredUnclearReason: () => {},
      // Gehoert einem PARALLEL laufenden Paket (Join-Schluessel sip_call_id) und hat mit
      // Action Items nichts zu tun - hier bewusst ein No-Op, damit dieser Test nicht an
      // dessen Zwischenstand haengt.
      recordSipCallId: () => {},
      save: () => {},
    },
  };
}

async function withFetch(fetchImpl, run) {
  const orig = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = orig;
  }
}

async function waitUntil(predicate, timeoutMs = WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Bedingung nicht innerhalb der Testfrist erreicht");
    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_INTERVAL_MS));
  }
}

// Faehrt den ECHTEN Poll-Weg gegen eine Anbieter-Antwort und liefert den Store-Zustand.
async function pollConversation(conversation) {
  const { state, call, store } = makeStateStore();
  call.elevenlabsConversationId = conversation.conversation_id;
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
      init.method === "GET"
        ? { ok: true, status: HTTP_OK, json: async () => conversation }
        : { ok: true, status: HTTP_OK },
    async () => {
      el.rearmActiveConversationPolls();
      await waitUntil(() => billed);
    },
  );
  return { state, call, store };
}

// ---- Ebene 1: der Poll-Weg schreibt das Action Item -------------------------------------

test("EL-Ergebnisabruf: der vereinbarte naechste Schritt landet als Action Item am Store", async () => {
  const { state, call } = await pollConversation(CONVERSATION_MIT_TERMIN);

  assert.equal(state.actionItems.length, 1, "genau ein Action Item aus einem naechsten Schritt");
  assert.equal(state.actionItems[0].text, NEXT_STEP_TEXT, "der Wortlaut des Anbieters, unveraendert");
  assert.equal(state.actionItems[0].callId, call.id, "es haengt am richtigen Anruf");
  assert.equal(state.actionItems[0].done, false);
  assert.deepEqual(call.actionItemIds, [state.actionItems[0].id], "der Anruf kennt sein Item");
});

test("EL-Ergebnisabruf: hat dasselbe Gespraech einen Termin hergegeben, ist der naechste Schritt ein Termin", async () => {
  const { state } = await pollConversation(CONVERSATION_MIT_TERMIN);
  assert.equal(state.actionItems[0].type, "appointment");
});

test("EL-Ergebnisabruf: ohne Termin im Gespraech ist der naechste Schritt eine Aufgabe", async () => {
  const { state } = await pollConversation(CONVERSATION_OHNE_TERMIN);
  assert.equal(state.actionItems.length, 1);
  assert.equal(state.actionItems[0].text, NEXT_STEP_WITHOUT_APPOINTMENT);
  assert.equal(state.actionItems[0].type, "todo");
});

test("EL-Ergebnisabruf: nennt das Gespraech keinen naechsten Schritt, entsteht KEIN Action Item - nichts wird erfunden", async () => {
  const { state } = await pollConversation(CONVERSATION_OHNE_NAECHSTEN_SCHRITT);
  assert.deepEqual(state.actionItems, []);
});

test("EL-Ergebnisabruf: ein zweiter Durchlauf derselben Antwort legt KEIN zweites Item an (Entdopplung des Bestands-Mutators)", async () => {
  const { state, call, store } = await pollConversation(CONVERSATION_MIT_TERMIN);
  // Denselben Wortlaut noch einmal einspeisen - genau das tut ein Beende-Versuch, der das
  // Ergebnis nach einem bereits gelaufenen Poll ein zweites Mal holt (endActiveCall).
  store.addActionItem(call.id, NEXT_STEP_TEXT, "appointment");
  assert.equal(state.actionItems.length, 1);
});

// ---- Ebene 2: das echte MCP-Werkzeug liest ihn ------------------------------------------

// Faengt die registrierten Handler ein. Beide Registrier-Formen der MCP-Bibliothek
// (tool(name, desc, schema, handler) und registerTool(name, config, handler)) tragen den
// Namen ZUERST und den Handler ZULETZT - deshalb genuegt EIN Sammler ueber Restargumente,
// statt zwei Signaturen nachzubauen.
function captureTools() {
  const handlers = new Map();
  const remember = (...args) => handlers.set(args[0], args.at(-1));
  registerTools(
    { tool: remember, registerTool: remember, registerResource: () => {} },
    { identity: null, allowCalendar: true },
  );
  return handlers;
}

// Liefert den echten Store-Zustand als /api/state aus und ruft list_action_items.
async function listActionItemsFor(state) {
  const server = http.createServer((_req, res) => {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify({ actionItems: state.actionItems }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = await captureTools().get("list_action_items")();
    return (result?.content || []).map((part) => part.text).join("\n");
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await new Promise((resolve) => server.close(resolve));
  }
}

test("list_action_items liefert nach einem ElevenLabs-Gespraech den vereinbarten naechsten Schritt statt Leertext", async () => {
  const { state } = await pollConversation(CONVERSATION_MIT_TERMIN);
  const text = await listActionItemsFor(state);

  assert.notEqual(
    text,
    "Keine offenen Action Items.",
    "GENAU DER BEFUND, den dieses Paket behebt: ohne Schreiber blieb das Werkzeug leer",
  );
  assert.match(text, /\(Termin\) /, "ein Termin traegt das Termin-Praefix");
  assert.ok(text.includes(NEXT_STEP_TEXT), `der Wortlaut muss ankommen, war: ${text}`);
});

test("list_action_items: ohne naechsten Schritt im Gespraech bleibt der ehrliche Leertext stehen", async () => {
  const { state } = await pollConversation(CONVERSATION_OHNE_NAECHSTEN_SCHRITT);
  assert.equal(await listActionItemsFor(state), "Keine offenen Action Items.");
});
