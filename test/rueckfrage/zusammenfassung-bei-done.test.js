import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer, seedState, seedCall } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { echtWarten } from "../echt-warten.js";
import http from "node:http";
import { registerTools } from "../../src/mcp-tools.js";
import { makeConsultDelivery } from "../../src/consult/delivery.js";
import { mitAuftragsurteil } from "../../src/elevenlabs/outbound.js";
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

const MCP_TENANT = "tenant_zusammenfassung";
const MCP_HALTEZEIT_MS = 1500;
const MCP_ZUSAMMENFASSUNG_WARTE_MS = 6000;
const MCP_ANRUF_ENDET_NACH_MS = 300;
const MCP_URTEIL_DAUERT_MS = 500;
const MCP_FRIST_NACH_HALTEZEIT_MS = 1500;
const MCP_ANRUF = "call_zusammenfassung_mcp";
const MCP_SUMMARY = "Der Termin am Donnerstag um zehn Uhr ist vereinbart.";

function mcpAnruf(status) {
  return {
    id: MCP_ANRUF,
    tenantId: MCP_TENANT,
    status,
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    transcript: SPRECHER,
    summary: null,
    objectiveAchieved: "unclear",
    failureReason: null,
    result: null,
  };
}

async function mitMcpGateway(anruf, run) {
  const store = {
    getCall: () => anruf,
    pendingConsult: () => null,
    tenantContext: () => ({ settings: { allowSummaries: true } }),
  };
  const lieferung = makeConsultDelivery({
    store,
    holdMs: MCP_HALTEZEIT_MS,
    summaryWaitMs: MCP_ZUSAMMENFASSUNG_WARTE_MS,
  });
  const server = http.createServer(async (req, res) => {
    const body = req.url.includes("/consult")
      ? await lieferung.waitForEvent({ callId: MCP_ANRUF, tenantId: MCP_TENANT, afterEventId: null })
      : anruf;
    res.writeHead(ERFOLG, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  const vorher = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${server.address().port}`;
  const handlers = new Map();
  registerTools(
    { registerTool: (name, _config, handler) => handlers.set(name, handler), registerResource() {} },
    { identity: null, scopedTenant: MCP_TENANT, consultAllowed: true, language: "de" },
  );
  const abfrage = async () =>
    (await handlers.get("await_call_event")({ call_id: MCP_ANRUF, after_event_id: undefined })).structuredContent;
  try {
    return await run({ abfrage });
  } finally {
    if (vorher === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = vorher;
    server.closeAllConnections();
    await new Promise((fertig) => server.close(fertig));
  }
}

function anrufEndetMitUrteil(anruf, dauerMs) {
  const nachlauf = mitAuftragsurteil({
    finishCall: async () => {},
    summarizeCall: async (call) => {
      await echtWarten(dauerMs);
      call.summary = MCP_SUMMARY;
    },
  });
  anruf.status = "completed";
  return nachlauf(anruf);
}

test("zusammenfassung-bei-done: await_call_event meldet done mit der Zusammenfassung, die waehrend der Abfrage eintrifft", async () => {
  const anruf = mcpAnruf("active");
  await mitMcpGateway(anruf, async ({ abfrage }) => {
    const offen = abfrage();
    await echtWarten(MCP_ANRUF_ENDET_NACH_MS);
    const nachlauf = anrufEndetMitUrteil(anruf, MCP_URTEIL_DAUERT_MS);
    const data = await offen;
    await nachlauf;
    assert.equal(data.event, "done");
    assert.equal(data.result_summary, MCP_SUMMARY);
  });
});

test("zusammenfassung-bei-done: await_call_event ueberschreitet die Haltezeit nicht und meldet beim naechsten Abruf done mit Zusammenfassung", async () => {
  const anruf = mcpAnruf("completed");
  await mitMcpGateway(anruf, async ({ abfrage }) => {
    const start = Date.now();
    const nachlauf = anrufEndetMitUrteil(anruf, MCP_HALTEZEIT_MS + MCP_URTEIL_DAUERT_MS);
    const erste = await abfrage();
    const dauerMs = Date.now() - start;
    assert.equal(erste.event, "none");
    assert.ok(dauerMs < MCP_HALTEZEIT_MS + MCP_FRIST_NACH_HALTEZEIT_MS, `Abfrage dauerte ${dauerMs} ms`);
    await nachlauf;
    const zweite = await abfrage();
    assert.equal(zweite.event, "done");
    assert.equal(zweite.result_summary, MCP_SUMMARY);
  });
});
