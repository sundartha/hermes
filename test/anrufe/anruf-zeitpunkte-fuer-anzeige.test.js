import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registerTools } from "../../src/mcp-tools.js";
import { startServer, DOMESTIC_TEST_NUMBER } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { echtWarten } from "../echt-warten.js";
import { starteJsonAttrappe } from "./attrappen-server.js";

const SECOND_MS = 1000;
const THIRTY_S_MS = 30 * SECOND_MS;
const TEN_S_MS = 10 * SECOND_MS;
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TIMING_TOLERANCE_S = 2;
const SHORT_WAIT_MS = 5;
const DURATION_COMPLETED_S = 60;
const TARGET = "+4915112340001";

function captureTools() {
  const handlers = new Map();
  const fakeServer = {
    registerTool(name, config, handler) {
      handlers.set(name, { handler, config });
    },
    registerResource() {},
  };
  registerTools(fakeServer, { identity: null });
  return handlers;
}

async function mitGateway(antwort, aktion) {
  const attrappe = await starteJsonAttrappe(antwort);
  const vorher = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = attrappe.url;
  try {
    return await aktion(captureTools());
  } finally {
    if (vorher === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = vorher;
    await attrappe.close();
  }
}

async function statusFuer(record) {
  return mitGateway({ status: "active", transcript: [], ...record }, async (tools) => {
    const result = await tools.get("get_call_status").handler({ call_id: "call_1" });
    return result.structuredContent;
  });
}

const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

test("get_call_status liefert server_time, started_at und answered_at und zaehlt ab dem Abheben", async () => {
  const startedAt = iso(-THIRTY_S_MS);
  const answeredAt = iso(-TEN_S_MS);
  const data = await statusFuer({ startedAt, answeredAt });
  assert.match(data.server_time, ISO_UTC_MS);
  assert.equal(data.started_at, startedAt);
  assert.equal(data.answered_at, answeredAt);
  assert.ok(Math.abs(data.duration_s - 10) <= TIMING_TOLERANCE_S, `duration_s ${data.duration_s}`);
});

test("get_call_status ohne Abheben: answered_at null und duration_s 0", async () => {
  const startedAt = iso(-THIRTY_S_MS);
  const data = await statusFuer({ startedAt });
  assert.equal(data.answered_at, null);
  assert.equal(data.started_at, startedAt);
  assert.equal(data.duration_s, 0);
});

test("get_call_status beendeter Anruf zaehlt vom Abheben bis zum Ende", async () => {
  const data = await statusFuer({
    status: "completed",
    startedAt: "2026-06-26T09:59:00.000Z",
    answeredAt: "2026-06-26T10:00:00.000Z",
    endedAt: "2026-06-26T10:01:00.000Z",
  });
  assert.equal(data.duration_s, DURATION_COMPLETED_S);
});

test("get_call_status: zwei Aufrufe nacheinander haben nicht fallende server_time", async () => {
  await mitGateway({ status: "active", startedAt: iso(-TEN_S_MS), transcript: [] }, async (tools) => {
    const erst = await tools.get("get_call_status").handler({ call_id: "call_1" });
    await echtWarten(SHORT_WAIT_MS);
    const zweit = await tools.get("get_call_status").handler({ call_id: "call_1" });
    const a = Date.parse(erst.structuredContent.server_time);
    const b = Date.parse(zweit.structuredContent.server_time);
    assert.ok(b >= a, `server_time fiel von ${a} auf ${b}`);
  });
});

test("get_call_status: ungueltige Zeitstrings ergeben null und duration_s 0", async () => {
  const data = await statusFuer({
    startedAt: "kein-datum",
    answeredAt: "auch-nicht",
    endedAt: "nie",
  });
  assert.equal(data.started_at, null);
  assert.equal(data.answered_at, null);
  assert.equal(data.duration_s, 0);
  const fehlend = await statusFuer({ startedAt: undefined });
  assert.equal(fehlend.started_at, null);
  assert.equal(fehlend.answered_at, null);
  assert.equal(fehlend.duration_s, 0);
});

test("get_call_status: Text im Antwortinhalt bleibt unveraendert", async () => {
  await mitGateway({ status: "active", startedAt: iso(-TEN_S_MS), transcript: [] }, async (tools) => {
    const result = await tools.get("get_call_status").handler({ call_id: "call_1" });
    assert.deepEqual(Object.keys(JSON.parse(result.content[0].text)), [
      "status",
      "duration_s",
      "last_transcript_lines",
    ]);
  });
});

test("place_call: erster Push traegt server_time, started_at und answered_at null; Text bleibt", async () => {
  const startedAt = iso(-TEN_S_MS);
  await mitGateway({ ok: true, callId: "call_9", startedAt, deduplicated: false }, async (tools) => {
    const result = await tools.get("place_call").handler({ to: TARGET, objective: "Termin" });
    const data = result.structuredContent;
    assert.match(data.server_time, ISO_UTC_MS);
    assert.equal(data.started_at, startedAt);
    assert.equal(data.answered_at, null);
    assert.equal(data.duration_s, 0);
    assert.equal(
      result.content[0].text,
      JSON.stringify({ call_id: "call_9", status: "dialing" }, null, 2),
    );
  });
});

test("Ausgabe-Schema: alte Antwort ohne die drei Felder bleibt gueltig, neue Felder sind erlaubt", () => {
  const tools = captureTools();
  const alt = {
    call_id: "c",
    status: "dialing",
    duration_s: 0,
    last_transcript_lines: [],
    failure_reason: null,
  };
  const schema = z.object(tools.get("get_call_status").config.outputSchema);
  assert.ok(schema.safeParse(alt).success);
  const neu = { ...alt, server_time: iso(0), started_at: iso(0), answered_at: null };
  assert.ok(schema.safeParse(neu).success);
});

test("POST /api/calls nennt startedAt des Anrufs, auch bei deduplicated", async () => {
  const srv = await startServer({
    ownerNumber: DOMESTIC_TEST_NUMBER,
    env: { ALLOWED_COUNTRY_CODES: "*", FAKE_ORIGINATE: "true" },
  });
  try {
    const post = () =>
      abrufMitFrist(`${srv.localUrl}/api/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: TARGET, objective: "Termin vereinbaren" }),
      }).then((response) => response.json());
    const erst = await post();
    const zweit = await post();
    assert.equal(zweit.deduplicated, true);
    const [anruf] = srv.readStore().calls;
    const gespeichert = anruf.startedAt;
    assert.equal(erst.startedAt, gespeichert);
    assert.equal(zweit.startedAt, gespeichert);
  } finally {
    await srv.stop();
  }
});
