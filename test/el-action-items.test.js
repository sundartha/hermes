import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import { registerTools } from "../src/mcp-tools.js";
import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import { terminateAndBillCall } from "../src/telephony/call-termination.js";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { storeOpsFacade, waitUntil, withFetch } from "./helpers.js";

const ACCOUNT = { apiKey: "test-key", apiBase: "https://el.test" };
const HTTP_OK = 200;

const NEXT_STEP_TEXT = "Bring the vehicle registration to the appointment on March 3.";
const NEXT_STEP_WITHOUT_APPOINTMENT = "Send over the damage photos by email this week.";

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
  return { state, call, store: storeOpsFacade(state) };
}

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
  store.addActionItem(call.id, NEXT_STEP_TEXT, "appointment");
  assert.equal(state.actionItems.length, 1);
});

function captureTools() {
  const handlers = new Map();
  const remember = (...args) => handlers.set(args[0], args.at(-1));
  registerTools(
    { tool: remember, registerTool: remember, registerResource: () => {} },
    { identity: null },
  );
  return handlers;
}

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
