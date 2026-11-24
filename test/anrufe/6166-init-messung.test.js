import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";
import { EL_CALL_BINDING_SIP_HEADER } from "../../src/elevenlabs/inbound-sip-uri.ts";
import { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER, makeElevenLabsInitWebhookRoutes } from "../../src/routes/webhooks-elevenlabs-init.ts";
import { EL_INBOUND_ACCESS_BOOT_ENV, startServer, waitForLog } from "../helpers.js";
import { INBOUND_TO, elInboundInitSpawnEnv, spawnSeedWartenderElCall } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_FEHLER = 500;
const AGENT_ID = "agent_6166_init";
const INIT_TOKEN = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN;
const CALL_ID = "call_6166_ein";
const TOKEN = "2".padStart(32, "0");
const ABGEHOBEN = "2026-01-01T10:00:00.000Z";
const FIRST_MESSAGE_ZEICHEN = 40;
const INHABER = "Jonas Beispiel";

const zeilen = (ausgabe, tag) => ausgabe.split("\n").filter((zeile) => zeile.startsWith(`[el-init] ${tag}`));
const kopf = { "content-type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN };
const koerper = (extra = {}) => ({
  agent_id: AGENT_ID,
  conversation_id: "conv_6166",
  called_number: INBOUND_TO,
  sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: TOKEN },
  ...extra,
});

async function mitServer(run) {
  const srv = await startServer({
    env: elInboundInitSpawnEnv(AGENT_ID),
    seed: spawnSeedWartenderElCall({ callId: CALL_ID, bindungsToken: TOKEN, answeredVorS: 1 }),
  });
  try {
    return await run(srv);
  } finally {
    await srv.stop();
  }
}

const sende = (srv, body) =>
  abrufMitFrist(`${srv.localUrl}${ELEVENLABS_INIT_PATH}`, { method: "POST", headers: kopf, body: JSON.stringify(body) });

test("6166-K1: Init 200 -> eine Zeile eingang nach der Zuordnung, eine Zeile antwort mit Status, Startsprache und ersten 40 Zeichen first_message", async () => {
  await mitServer(async (srv) => {
    const antwort = await sende(srv, koerper());
    assert.equal(antwort.status, HTTP_OK);
    const agent = (await antwort.json()).conversation_config_override.agent;
    assert.ok(agent.first_message.length > 0);
    await waitForLog(srv, /\[el-init\] antwort /);
    assert.deepEqual(zeilen(srv.stdout, "eingang"), [`[el-init] eingang call=${CALL_ID}`]);
    assert.deepEqual(zeilen(srv.stdout, "antwort"), [
      `[el-init] antwort call=${CALL_ID} status=200 sprache=${agent.language} erste_rede=${JSON.stringify(agent.first_message.replaceAll(INHABER, "***").slice(0, FIRST_MESSAGE_ZEICHEN))}`,
    ]);
    const log = srv.stdout.split("\n");
    assert.ok(log.findIndex((zeile) => zeile.startsWith("[el-init] eingang")) < log.findIndex((zeile) => zeile.startsWith("[el-init] gebunden")));
    assert.ok(log.findIndex((zeile) => zeile.startsWith("[el-init] gebunden")) < log.findIndex((zeile) => zeile.startsWith("[el-init] antwort")));
  });
});

test("6166-K1b: Init 404 -> Zeile antwort mit Status 404, mit Anruf nach eingang, ohne Anruf ohne call und ohne Sprache", async () => {
  await mitServer(async (srv) => {
    assert.equal((await sende(srv, koerper({ agent_id: "agent_fremd" }))).status, HTTP_NOT_FOUND);
    await waitForLog(srv, /\[el-init\] antwort /);
    assert.deepEqual(zeilen(srv.stdout, "eingang"), [`[el-init] eingang call=${CALL_ID}`]);
    assert.deepEqual(zeilen(srv.stdout, "antwort"), [`[el-init] antwort call=${CALL_ID} status=404`]);
    const unbekannt = await sende(srv, koerper({ sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: "9".padStart(32, "0") } }));
    assert.equal(unbekannt.status, HTTP_NOT_FOUND);
    await waitForLog(srv, /\[el-init\] antwort status=404/);
    assert.equal(zeilen(srv.stdout, "eingang").length, 1);
  });
});

const AUSGEHEND = {
  id: "call_6166_aus",
  from: "+15005550006",
  to: "+491737250000",
  tenantId: "t",
  costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
  streamToken: TOKEN,
  elBoundAt: null,
};

async function initMitInhalt(inhalt) {
  const store = {
    aktiveAnrufeAlle: async () => [{ ...AUSGEHEND, answeredAt: ABGEHOBEN }],
    getCall: () => AUSGEHEND,
    tenantContext: () => ({ ownerName: "", firstName: "" }),
    bindInboundElConversation: () => ({ bound: true, changed: true, call: AUSGEHEND }),
  };
  const config = { voice: { elevenLabsInbound: { initWebhookToken: INIT_TOKEN }, elevenLabsOutbound: { agentId: AGENT_ID } } };
  const app = express();
  app.use(express.json());
  app.use(makeElevenLabsInitWebhookRoutes({ store, config, bridges: { clearDeadlines() {} }, outboundInitInhalt: inhalt, vorspannText: () => null }));
  const server = http.createServer(app);
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  const gelogt = [];
  const original = console.log;
  const fehler = console.error;
  console.log = (text) => gelogt.push(String(text));
  console.error = () => {};
  try {
    const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}${ELEVENLABS_INIT_PATH}`, {
      method: "POST",
      headers: kopf,
      body: JSON.stringify(koerper({ called_number: AUSGEHEND.from })),
    });
    return { status: antwort.status, zeile: gelogt.filter((zeile) => zeile.startsWith("[el-init] antwort")) };
  } finally {
    console.log = original;
    console.error = fehler;
    server.closeAllConnections();
    await new Promise((fertig) => server.close(fertig));
  }
}

test("6166-K1c: Init 500 -> Zeile antwort mit Status 500 und dem Anruf", async () => {
  const ergebnis = await initMitInhalt(() => {
    throw new Error("boom");
  });
  assert.equal(ergebnis.status, HTTP_SERVER_FEHLER);
  assert.deepEqual(ergebnis.zeile, ["[el-init] antwort call=call_6166_aus status=500"]);
});

const override = (agent) => ({ conversation_config_override: { agent } });
const ERSTE_40 = "a".repeat(FIRST_MESSAGE_ZEICHEN);

test("6166-K2: Startsprache und erste 40 Zeichen first_message als Tabelle, ohne eines von beiden keine Felder", async () => {
  const faelle = [
    [override({ language: "pt", first_message: `${ERSTE_40}b` }), ` sprache=pt erste_rede="${ERSTE_40}"`],
    [override({ language: "de", first_message: ERSTE_40 }), ` sprache=de erste_rede="${ERSTE_40}"`],
    [override({ language: "de", first_message: "" }), ` sprache=de erste_rede=""`],
    [override({ language: "de" }), ""],
    [override({ first_message: "Hallo" }), ""],
    [override({ language: 5, first_message: "Hallo" }), ""],
    [override({ language: "de", first_message: 5 }), ""],
    [{}, ""],
  ];
  for (const [antwort, erwartet] of faelle) {
    const ergebnis = await initMitInhalt(() => antwort);
    assert.equal(ergebnis.status, HTTP_OK);
    assert.deepEqual(ergebnis.zeile, [`[el-init] antwort call=call_6166_aus status=200${erwartet}`], JSON.stringify(antwort));
  }
});


test("6166-K3: eingehender Anruf -> Zeile antwort enthaelt weder Namen des Inhabers noch Vor- oder Nachnamen, stattdessen ***", async () => {
  const seed = spawnSeedWartenderElCall({ callId: CALL_ID, bindungsToken: TOKEN, answeredVorS: 1 });
  const srv = await startServer({ env: elInboundInitSpawnEnv(AGENT_ID), seed });
  try {
    const antwort = await sende(srv, koerper());
    assert.equal(antwort.status, HTTP_OK);
    const agent = (await antwort.json()).conversation_config_override.agent;
    assert.ok(agent.first_message.includes(INHABER));
    await waitForLog(srv, /\[el-init\] antwort /);
    const [zeile] = zeilen(srv.stdout, "antwort");
    assert.ok(!zeile.includes("Jonas"), zeile);
    assert.ok(!zeile.includes("Beispiel"), zeile);
    assert.ok(zeile.includes("***"), zeile);
    assert.equal(zeile, `[el-init] antwort call=${CALL_ID} status=200 sprache=${agent.language} erste_rede=${JSON.stringify(agent.first_message.replaceAll(INHABER, "***").slice(0, FIRST_MESSAGE_ZEICHEN))}`);
  } finally {
    await srv.stop();
  }
});
