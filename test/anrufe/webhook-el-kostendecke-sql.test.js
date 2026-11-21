import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

process.env.CONSULT_ENABLED = "true";
process.env.ASSISTANT_CONTEXT_ENABLED = "true";
process.env.IN_CALL_CONSULT_ENABLED = "true";

const { makeElevenLabsWebhookRoutes } = await import("../../src/routes/webhooks-elevenlabs.ts");
const { config } = await import("../../src/config.ts");

const HTTP_OK = 200;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_SERVER_ERROR = 500;
const TOOL_TOKEN = "kostendecke-tool-token-testgeheim";
const TENANT_ID = "tenant_kostendecke";
const CONVERSATION_ID = "conv_kostendecke";
const LAUFZEIT_MS = 600_000;
const WEGE = Object.freeze({
  consult: { pfad: "/webhooks/elevenlabs/consult", koerper: { question: "Passt Donnerstag?" } },
  lookup: { pfad: "/webhooks/elevenlabs/lookup", koerper: { query: "opening hours Grove Street Auto Repair" } },
});

config.voice.elevenLabsToolToken = TOOL_TOKEN;
config.research.lookupEnabled = true;
config.research.exaApiKey = "exa-kostendecke";

const anruf = (id, extra = {}) => ({
  id,
  tenantId: TENANT_ID,
  direction: "outbound",
  status: "active",
  elevenlabsConversationId: CONVERSATION_ID,
  consults: [],
  context: { key_facts: [] },
  startedAt: new Date(Date.now() - LAUFZEIT_MS).toISOString(),
  answeredAt: new Date(Date.now() - LAUFZEIT_MS).toISOString(),
  ...extra,
});

function speicher({ sql, spiegel = [], auffrischen = async () => true }) {
  const gebunden = anruf("call_kostendecke_gebunden", { startedAt: new Date().toISOString(), answeredAt: new Date().toISOString() });
  return {
    load: () => ({ calls: [gebunden] }),
    aktiveAnrufeAlle: async () => [gebunden].filter((call) => call.status === "active"),
    attachActiveCall: async (id) => [gebunden].find((call) => call.id === id && call.status === "active") ?? null,
    getCall: () => gebunden,
    resolveProfile: () => ({ allowConsult: true, allowLookup: true }),
    nutzungAuffrischen: auffrischen,
    activeCallsForSql: sql,
    activeCallsFor: () => spiegel,
    liveBudgetExceeded: (_mandant, cents) => cents > 0,
  };
}

async function mitRoute(store, lauf) {
  const app = express();
  app.use(express.json());
  app.use(
    makeElevenLabsWebhookRoutes({
      store,
      config,
      consultSlots: { withOpenSlot: async (_id, _mandant, run) => ({ granted: true, value: await run() }) },
      onConsultRaised: async () => ({ kind: "rejected", reason: "frage_abgelehnt", facts: [] }),
      auditFor: () => () => {},
    }),
  );
  const server = http.createServer(app);
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  try {
    return await lauf(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((fertig) => server.close(fertig));
  }
}

const rufe = (url, weg) =>
  abrufMitFrist(`${url}${WEGE[weg].pfad}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hermes-tool-token": TOOL_TOKEN },
    body: JSON.stringify({ conversation_id: CONVERSATION_ID, ...WEGE[weg].koerper }),
  });

async function pruefeFremdenAnruf(weg) {
  const store = speicher({ sql: async () => [anruf("call_kostendecke_fremd")] });
  await mitRoute(store, async (url) => {
    const antwort = await rufe(url, weg);
    assert.equal(antwort.status, HTTP_PAYMENT_REQUIRED);
    assert.deepEqual(await antwort.json(), { error: "budget_tenant" });
  });
}

async function pruefeSpiegelBeiLesefehler(t, weg) {
  t.mock.method(console, "error", () => {});
  const store = speicher({
    sql: async () => {
      throw new Error("db weg");
    },
    spiegel: [anruf("call_kostendecke_spiegel")],
  });
  await mitRoute(store, async (url) => {
    const antwort = await rufe(url, weg);
    assert.equal(antwort.status, HTTP_PAYMENT_REQUIRED);
  });
}

async function pruefeAuffrischenFehler(t, weg) {
  t.mock.method(console, "error", () => {});
  const store = speicher({
    sql: async () => [],
    auffrischen: async () => {
      throw new Error("db weg");
    },
  });
  await mitRoute(store, async (url) => {
    const antwort = await rufe(url, weg);
    assert.equal(antwort.status, HTTP_SERVER_ERROR);
    assert.deepEqual(await antwort.json(), { error: "intern" });
  });
}

test("EL-KOSTENDECKE consult: ein laufender Anruf einer anderen Instanz, den nur die Datenbank kennt, sperrt mit 402", () =>
  pruefeFremdenAnruf("consult"));

test("EL-KOSTENDECKE lookup: ein laufender Anruf einer anderen Instanz, den nur die Datenbank kennt, sperrt mit 402", () =>
  pruefeFremdenAnruf("lookup"));

test("EL-KOSTENDECKE consult: ist die Datenbank nicht lesbar, entscheidet der Spiegel dieses Prozesses und sperrt mit 402", (t) =>
  pruefeSpiegelBeiLesefehler(t, "consult"));

test("EL-KOSTENDECKE lookup: ist die Datenbank nicht lesbar, entscheidet der Spiegel dieses Prozesses und sperrt mit 402", (t) =>
  pruefeSpiegelBeiLesefehler(t, "lookup"));

test("EL-KOSTENDECKE consult: schlaegt die Auffrischung selbst fehl, laesst der Webhook nichts durch und antwortet 500", (t) =>
  pruefeAuffrischenFehler(t, "consult"));

test("EL-KOSTENDECKE lookup: schlaegt die Auffrischung selbst fehl, laesst der Webhook nichts durch und antwortet 500", (t) =>
  pruefeAuffrischenFehler(t, "lookup"));

test("EL-KOSTENDECKE consult: ohne laufenden Anruf in der Datenbank wird nicht gesperrt", async () => {
  const store = speicher({ sql: async () => [] });
  await mitRoute(store, async (url) => {
    const antwort = await rufe(url, "consult");
    assert.equal(antwort.status, HTTP_OK);
    assert.equal((await antwort.json()).status, "rejected");
  });
});
