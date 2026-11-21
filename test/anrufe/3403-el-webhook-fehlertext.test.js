import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { startServer, seedState, seedCall, waitForLog } from "../helpers.js";

const { makeElevenLabsWebhookRoutes } = await import("../../src/routes/webhooks-elevenlabs.ts");
const { config } = await import("../../src/config.ts");

const TOOL_TOKEN = "fehlertext-tool-token-testgeheim";
const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;
const CONSULT_PFAD = "/webhooks/elevenlabs/consult";
const LOOKUP_PFAD = "/webhooks/elevenlabs/lookup";

config.voice.elevenLabsToolToken = TOOL_TOKEN;

async function fehlerZeilenBei(pfad, fehler) {
  const store = {
    load: () => {
      throw fehler;
    },
    aktiveAnrufeAlle: async () => {
      throw fehler;
    },
  };
  const app = express();
  app.use(express.json());
  app.use(
    makeElevenLabsWebhookRoutes({
      store,
      config,
      consultSlots: {},
      onConsultRaised: () => {},
      auditFor: () => {},
    }),
  );
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const zeilen = [];
  const original = console.error;
  console.error = (...a) => zeilen.push(a.map(String).join(" "));
  try {
    const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}${pfad}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hermes-tool-token": TOOL_TOKEN },
      body: JSON.stringify({
        conversation_id: "conv_fehlertext",
        question: "Frage?",
        query: "Suche",
      }),
    });
    assert.equal(res.status, HTTP_SERVER_ERROR);
    assert.deepEqual(await res.json(), { error: "intern" });
    return zeilen;
  } finally {
    console.error = original;
    await new Promise((resolve) => server.close(resolve));
  }
}

const mitStack = (stack, message) => Object.assign(new Error(message), { stack });

test("3403-F1: Recherche-Webhook loggt bei einem Fehler mit Stack genau den Stack", async () => {
  assert.deepEqual(await fehlerZeilenBei(LOOKUP_PFAD, mitStack("stack-text", "nachricht")), [
    "[el-lookup] fehler: stack-text",
  ]);
});

test("3403-F2: Recherche-Webhook loggt bei leerem Stack die Nachricht", async () => {
  assert.deepEqual(await fehlerZeilenBei(LOOKUP_PFAD, mitStack("", "nur-nachricht")), [
    "[el-lookup] fehler: nur-nachricht",
  ]);
});

test("3403-F3: Recherche-Webhook loggt bei einem Objekt mit Nachricht ohne Stack die Nachricht", async () => {
  assert.deepEqual(await fehlerZeilenBei(LOOKUP_PFAD, { message: "objekt-text" }), [
    "[el-lookup] fehler: objekt-text",
  ]);
});

test("3403-F4: Recherche-Webhook loggt bei einem Text, null oder leerem Objekt unbekannt", async () => {
  assert.deepEqual(await fehlerZeilenBei(LOOKUP_PFAD, "boom"), ["[el-lookup] fehler: unbekannt"]);
  assert.deepEqual(await fehlerZeilenBei(LOOKUP_PFAD, null), ["[el-lookup] fehler: unbekannt"]);
  assert.deepEqual(await fehlerZeilenBei(LOOKUP_PFAD, {}), ["[el-lookup] fehler: unbekannt"]);
});

test("3403-F5: Recherche-Webhook ignoriert Stack und Nachricht, die kein Text sind", async () => {
  assert.deepEqual(await fehlerZeilenBei(LOOKUP_PFAD, { stack: 42, message: "text" }), [
    "[el-lookup] fehler: text",
  ]);
  assert.deepEqual(await fehlerZeilenBei(LOOKUP_PFAD, { message: 42 }), [
    "[el-lookup] fehler: unbekannt",
  ]);
});

test("3403-F6: Konsultations-Webhook loggt Stack, Nachricht und unbekannt wie die Recherche", async () => {
  assert.deepEqual(await fehlerZeilenBei(CONSULT_PFAD, mitStack("stack-text", "nachricht")), [
    "[el-consult] fehler: stack-text",
  ]);
  assert.deepEqual(await fehlerZeilenBei(CONSULT_PFAD, { message: "objekt-text" }), [
    "[el-consult] fehler: objekt-text",
  ]);
  assert.deepEqual(await fehlerZeilenBei(CONSULT_PFAD, "boom"), ["[el-consult] fehler: unbekannt"]);
  assert.deepEqual(await fehlerZeilenBei(CONSULT_PFAD, { stack: 42, message: "text" }), [
    "[el-consult] fehler: text",
  ]);
});

test("3403-F7: ist die Antwort schon begonnen, beendet der Fehlerfall sie ohne zweite Antwort", async () => {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.writeHead(HTTP_OK, { "Content-Type": "text/plain" });
    res.write("begonnen");
    next();
  });
  const store = {
    load: () => {
      throw new Error("spaet");
    },
  };
  app.use(
    makeElevenLabsWebhookRoutes({
      store,
      config,
      consultSlots: {},
      onConsultRaised: () => {},
      auditFor: () => {},
    }),
  );
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const original = console.error;
  console.error = () => {};
  try {
    const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}${LOOKUP_PFAD}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hermes-tool-token": TOOL_TOKEN },
      body: JSON.stringify({ conversation_id: "conv_fehlertext", query: "Suche" }),
    });
    assert.equal(res.status, HTTP_OK);
    assert.equal(await res.text(), "begonnen");
  } finally {
    console.error = original;
    await new Promise((resolve) => server.close(resolve));
  }
});

const LOGGED_CALL_ID = "call_3403_log";
const LOGGED_CONVERSATION_ID = "conv_3403_log";
const LOGGED_TOKEN = "log-tool-token-testgeheim";

async function lookupLogZeile(exaBase, muster) {
  const srv = await startServer({
    env: {
      LOOKUP_ENABLED: "true",
      EXA_API_KEY: "exa-test-key",
      EXA_API_BASE: exaBase,
      ELEVENLABS_TOOL_TOKEN: LOGGED_TOKEN,
      SKIP_TWILIO_SIGNATURE_CHECK: "false",
      MULTI_TENANT: "true",
    },
    seed: seedState({
      calls: [
        seedCall({
          id: LOGGED_CALL_ID,
          status: "active",
          maxDurationS: 300,
          elevenlabsConversationId: LOGGED_CONVERSATION_ID,
        }),
      ],
    }),
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}${LOOKUP_PFAD}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hermes-tool-token": LOGGED_TOKEN },
      body: JSON.stringify({
        conversation_id: LOGGED_CONVERSATION_ID,
        query: "opening hours Grove Street Auto Repair",
      }),
    });
    assert.equal(res.status, HTTP_OK);
    await waitForLog(srv, muster);
    return srv.stdout;
  } finally {
    await srv.stop();
  }
}

test("3403-F8: Recherche-Webhook protokolliert Erfolg mit ok=true, Dauer und Faktenzahl", async () => {
  const exa = http.createServer((_req, res) => {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        results: [{ title: "Titel", url: "https://x.invalid", highlights: ["Text"] }],
      }),
    );
  });
  await new Promise((resolve) => exa.listen(0, "127.0.0.1", resolve));
  try {
    const log = await lookupLogZeile(
      `http://127.0.0.1:${exa.address().port}`,
      /\[el-lookup\] fertig call=call_3403_log ok=true dauer_ms=\d+ fakten=1\n/,
    );
    assert.match(log, /\[el-lookup\] fertig call=call_3403_log ok=true dauer_ms=\d+ fakten=1\n/);
  } finally {
    await new Promise((resolve) => exa.close(resolve));
  }
});

test("3403-F9: Recherche-Webhook protokolliert gescheiterte Suche mit ok=false und fakten=0", async () => {
  const log = await lookupLogZeile(
    "http://127.0.0.1:1",
    /\[el-lookup\] fertig call=call_3403_log ok=false dauer_ms=\d+ fakten=0\n/,
  );
  assert.match(log, /\[el-lookup\] fertig call=call_3403_log ok=false dauer_ms=\d+ fakten=0\n/);
});
