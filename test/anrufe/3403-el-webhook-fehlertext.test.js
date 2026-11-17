import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const { makeElevenLabsWebhookRoutes } = await import("../../src/routes/webhooks-elevenlabs.js");
const { config } = await import("../../src/config.js");

const TOOL_TOKEN = "fehlertext-tool-token-testgeheim";
const HTTP_SERVER_ERROR = 500;
const CONSULT_PFAD = "/webhooks/elevenlabs/consult";
const LOOKUP_PFAD = "/webhooks/elevenlabs/lookup";

config.voice.elevenLabsToolToken = TOOL_TOKEN;

async function fehlerZeilenBei(pfad, fehler) {
  const store = {
    load: () => {
      throw fehler;
    },
  };
  const app = express();
  app.use(express.json());
  app.use(makeElevenLabsWebhookRoutes({ store, config, consultSlots: {}, onConsultRaised: () => {}, auditFor: () => {} }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const zeilen = [];
  const original = console.error;
  console.error = (...a) => zeilen.push(a.map(String).join(" "));
  try {
    const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}${pfad}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hermes-tool-token": TOOL_TOKEN },
      body: JSON.stringify({ conversation_id: "conv_fehlertext", question: "Frage?", query: "Suche" }),
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
  assert.deepEqual(await fehlerZeilenBei(LOOKUP_PFAD, { stack: 42, message: "text" }), ["[el-lookup] fehler: text"]);
  assert.deepEqual(await fehlerZeilenBei(LOOKUP_PFAD, { message: 42 }), ["[el-lookup] fehler: unbekannt"]);
});

test("3403-F6: Konsultations-Webhook loggt Stack, Nachricht und unbekannt wie die Recherche", async () => {
  assert.deepEqual(await fehlerZeilenBei(CONSULT_PFAD, mitStack("stack-text", "nachricht")), [
    "[el-consult] fehler: stack-text",
  ]);
  assert.deepEqual(await fehlerZeilenBei(CONSULT_PFAD, { message: "objekt-text" }), [
    "[el-consult] fehler: objekt-text",
  ]);
  assert.deepEqual(await fehlerZeilenBei(CONSULT_PFAD, "boom"), ["[el-consult] fehler: unbekannt"]);
  assert.deepEqual(await fehlerZeilenBei(CONSULT_PFAD, { stack: 42, message: "text" }), ["[el-consult] fehler: text"]);
});
