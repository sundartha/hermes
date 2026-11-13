import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer, seedState, seedCall } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { echtWarten } from "../echt-warten.js";
import http from "node:http";
import { registerTools } from "../../src/mcp-tools.js";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";

const ANRUF = "call_zusammenfassung_bei_done";
const ERFOLG = 200;
const SOFORT_MS = 1000;
const OFFEN_MS = 300;
const FRIST_MS = 15000;
const FRIST_UNTERGRENZE_MS = 14500;
const SUMMARY = "Termin am Donnerstag ist vereinbart.";
const SPRECHER = [{ role: "agent", text: "Passt Donnerstag?" }];

const ENV = Object.freeze({
  CONSULT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
});

async function abholen({ anruf = {}, settings = {}, wartezeitMs = 0 }) {
  const seed = seedState({
    settings,
    calls: [
      seedCall({
        id: ANRUF,
        direction: "outbound",
        status: "completed",
        transcript: SPRECHER,
        ...anruf,
      }),
    ],
  });
  const srv = await startServer({ env: ENV, seed });
  try {
    const start = Date.now();
    const antwort = await abrufMitFrist(
      `${srv.localUrl}/api/calls/${ANRUF}/consult`,
      {},
      { wartezeitMs },
    );
    assert.equal(antwort.status, ERFOLG);
    return { event: (await antwort.json()).event, dauerMs: Date.now() - start };
  } finally {
    await srv.stop();
  }
}

test("zusammenfassung-bei-done: ohne Zusammenfassung meldet done erst nach der Frist", async () => {
  const { event, dauerMs } = await abholen({ wartezeitMs: FRIST_MS });
  assert.equal(event, "done");
  assert.ok(dauerMs >= FRIST_UNTERGRENZE_MS, `done nach ${dauerMs} ms`);
});

test("zusammenfassung-bei-done: vorhandene Zusammenfassung meldet done sofort", async () => {
  const { event, dauerMs } = await abholen({ anruf: { summary: SUMMARY } });
  assert.equal(event, "done");
  assert.ok(dauerMs < SOFORT_MS, `done nach ${dauerMs} ms`);
});

test("zusammenfassung-bei-done: fehlgeschlagener Anruf meldet done sofort", async () => {
  const { event, dauerMs } = await abholen({ anruf: { status: "failed" } });
  assert.equal(event, "done");
  assert.ok(dauerMs < SOFORT_MS, `done nach ${dauerMs} ms`);
});

test("zusammenfassung-bei-done: ohne Transkript meldet done sofort", async () => {
  const { event, dauerMs } = await abholen({ anruf: { transcript: [] } });
  assert.equal(event, "done");
  assert.ok(dauerMs < SOFORT_MS, `done nach ${dauerMs} ms`);
});

test("zusammenfassung-bei-done: ohne erlaubte Zusammenfassung meldet done sofort", async () => {
  const { event, dauerMs } = await abholen({ settings: { allowSummaries: false } });
  assert.equal(event, "done");
  assert.ok(dauerMs < SOFORT_MS, `done nach ${dauerMs} ms`);
});

test("zusammenfassung-bei-done: beim Herunterfahren wartet ein offener Abruf nicht auf die Zusammenfassung", async () => {
  const seed = seedState({
    calls: [
      seedCall({ id: ANRUF, direction: "outbound", status: "completed", transcript: SPRECHER }),
    ],
  });
  const srv = await startServer({ env: ENV, seed });
  const abruf = abrufMitFrist(`${srv.localUrl}/api/calls/${ANRUF}/consult`).catch(() => null);
  await echtWarten(OFFEN_MS);
  const start = Date.now();
  await srv.stop();
  await abruf;
  assert.ok(Date.now() - start < FRIST_UNTERGRENZE_MS - SOFORT_MS * 5);
});

const MCP_TENANT = seedCall().tenantId;
const MCP_ANRUF = "call_4065_zusammenfassung";
const MCP_SUMMARY = "Der Termin am Donnerstag um zehn Uhr ist vereinbart.";
const POLL_TAKT_MS = 600000;
const HALTEZEIT_MS = 22000;
const GATEWAY_ABBRUCH_MS = 25000;
const MS_PRO_S = 1000;
const KURZ_ENDE_S = 2;
const KURZ_URTEIL_MS = 2000;
const SPAET_ENDE_S = 18;
const SPAET_URTEIL_MS = 8000;
const FRIST_REST_MS = 1000;

const gespraech = (status) => ({
  conversation_id: "conv_4065",
  status,
  transcript: [
    { role: "agent", message: "Passt Donnerstag um zehn?" },
    { role: "user", message: "Ja, passt." },
  ],
  analysis: { call_successful: "success" },
  metadata: { call_duration_secs: 2, phone_call: { direction: "outbound", call_id: "otb_4065" } },
});

const modellAntwort = (text) => ({
  id: "msg_4065",
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5",
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 20, output_tokens: 30 },
});

function lausche(handler) {
  const server = http.createServer(handler);
  return new Promise((bereit) => server.listen(0, "127.0.0.1", () => bereit(server)));
}

async function mitEndendemAnruf({ endeNachS, urteilDauertMs }, run) {
  const modell = await lausche((req, res) => {
    req.on("data", () => {});
    req.on("end", async () => {
      await echtWarten(urteilDauertMs);
      res.setHeader("content-type", "application/json");
      const urteil = { summary: MCP_SUMMARY, actionItems: [], objective_achieved: true };
      res.end(JSON.stringify(modellAntwort(JSON.stringify(urteil))));
    });
  });
  const beginn = Date.now();
  const elevenLabs = await lausche((req, res) => {
    res.setHeader("content-type", "application/json");
    const beendet = Date.now() >= beginn + endeNachS * MS_PRO_S;
    res.end(JSON.stringify(gespraech(beendet ? "done" : "processing")));
  });
  const srv = await startServer({
    env: {
      ...ENV,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${modell.address().port}`,
      ANTHROPIC_API_KEY: "test-4065-key",
      ELEVENLABS_API_BASE: `http://127.0.0.1:${elevenLabs.address().port}`,
      ELEVENLABS_API_KEY: "test-key",
      ELEVENLABS_RESULT_POLL_MS: String(POLL_TAKT_MS),
    },
    seed: seedState({
      calls: [
        seedCall({
          id: MCP_ANRUF,
          costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
          goal: "Termin am Donnerstag vereinbaren",
          elevenlabsConversationId: "conv_4065",
          answeredAt: new Date(beginn).toISOString(),
          maxDurationS: endeNachS,
        }),
      ],
    }),
  });
  const vorher = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = srv.localUrl;
  const handlers = new Map();
  registerTools(
    { registerTool: (name, _config, handler) => handlers.set(name, handler), registerResource() {} },
    { identity: null, scopedTenant: MCP_TENANT, consultAllowed: true, language: "de" },
  );
  const abfrage = async () => {
    const start = Date.now();
    const ergebnis = await handlers.get("await_call_event")({ call_id: MCP_ANRUF, after_event_id: undefined });
    return { data: ergebnis.structuredContent, dauerMs: Date.now() - start };
  };
  try {
    return await run({ abfrage });
  } finally {
    if (vorher === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = vorher;
    await srv.stop();
    await new Promise((fertig) => modell.close(fertig));
    await new Promise((fertig) => elevenLabs.close(fertig));
  }
}

test("zusammenfassung-bei-done: await_call_event meldet done mit der Zusammenfassung, die nach dem Anrufende waehrend der Abfrage eintrifft", async () => {
  await mitEndendemAnruf({ endeNachS: KURZ_ENDE_S, urteilDauertMs: KURZ_URTEIL_MS }, async ({ abfrage }) => {
    const { data } = await abfrage();
    assert.equal(data.event, "done");
    assert.equal(data.result_summary, MCP_SUMMARY);
  });
});

test("zusammenfassung-bei-done: await_call_event antwortet nie nach der Haltezeit und meldet beim naechsten Abruf done mit Zusammenfassung", async () => {
  await mitEndendemAnruf({ endeNachS: SPAET_ENDE_S, urteilDauertMs: SPAET_URTEIL_MS }, async ({ abfrage }) => {
    const erste = await abfrage();
    assert.equal(erste.data.event, "none");
    assert.ok(erste.dauerMs < HALTEZEIT_MS + FRIST_REST_MS, `Abfrage dauerte ${erste.dauerMs} ms`);
    assert.ok(erste.dauerMs < GATEWAY_ABBRUCH_MS - FRIST_REST_MS * 2);
    const zweite = await abfrage();
    assert.equal(zweite.data.event, "done");
    assert.equal(zweite.data.result_summary, MCP_SUMMARY);
  });
});
