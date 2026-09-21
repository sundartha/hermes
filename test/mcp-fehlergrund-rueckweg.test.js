// OUTBOUND-E3a (F2a): der MCP-Rueckweg (await_call_event/get_transcript) bekommt Ausgang
// UND Grund - der Weg, in den die Server-Instruktionen das Modell tatsaechlich schicken.
// Offline, kein echter Anruf: ein lokaler HTTP-Mock spielt das Gateway (GATEWAY_URL),
// Muster test/mcp-tools-language.test.js#withGateway. Testnamen ohne Katalog-Praefix
// (Lehre catalog-id-prefix-misroutes-tests).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools, pickTranscript } from "../src/mcp-tools.js";
import { FAILURE_REASON_TEXTS } from "../src/i18n/failure-reason-texts.js";
import { MCP_TEXTS } from "../src/i18n/mcp-texts.js";
import { MCP_CONSULT_INSTRUCTIONS } from "../src/mcp-server-info.js";
import { NOT_PLACED, failureReasonBase } from "../src/telephony/failure-reason.js";

const CALL_ID = "call_p2a";
const AWAIT_SUMMARY_PLACEHOLDER =
  "(Noch keine Zusammenfassung verfuegbar - ggf. 5 Sekunden warten und erneut aufrufen.)";
const HTTP_OK = 200;

function captureTools(ctx) {
  const handlers = new Map();
  const fakeServer = {
    // server.tool(name, desc, schema, handler) - das Bestands-4-Argumente-API (frozen).
    // Rest-Parameter statt vier benannter Positionen (max-params 3): das Fake braucht
    // nur name und die letzte Position (handler), desc/schema sind hier irrelevant.
    tool(name, ...rest) {
      handlers.set(name, rest[rest.length - 1]);
    },
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return handlers;
}

// Lokaler Gateway-Mock: /consult liefert das Consult-Event, jeder andere Pfad den
// (finished) Call-Record. Beide Antworten pro Test frei waehlbar.
async function startGatewayMock({ consultBody, callBody }) {
  const server = http.createServer((req, res) => {
    const body = req.url.includes("/consult") ? consultBody : callBody;
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(body ?? {}));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withGateway({ consultBody, callBody }, fn) {
  const mock = await startGatewayMock({ consultBody, callBody });
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
}

async function awaitCallEvent({ consultBody, callBody, language = "de" }) {
  return withGateway({ consultBody, callBody }, async () => {
    const handlers = captureTools({ identity: null, scopedTenant: "tenant_p2a", consultAllowed: true, language });
    const result = await handlers.get("await_call_event")({ call_id: CALL_ID, after_event_id: undefined });
    return result.structuredContent;
  });
}

const RUNNING_CONSULT = { event: "none", eventId: null, questions: [] };
const DONE_CONSULT = { event: "done", eventId: null, questions: [] };

function finishedCall(overrides = {}) {
  return {
    status: "failed",
    transcript: [],
    summary: null,
    objectiveAchieved: "unclear",
    failureReason: null,
    result: null,
    ...overrides,
  };
}

test("1: terminaler Anruf MIT Grund - status+failure_reason befuellt, result_summary traegt die Phrase", async () => {
  const data = await awaitCallEvent({
    consultBody: DONE_CONSULT,
    callBody: finishedCall({ failureReason: "not-placed:invite-403-D51" }),
  });

  assert.equal(data.status, "failed");
  // P5b (O-13 Teil 2): an der MCP-Kante nur noch das Basis-Token, nicht das volle Detail.
  assert.equal(data.failure_reason, NOT_PLACED);
  assert.ok(data.result_summary.includes(FAILURE_REASON_TEXTS.de.phrases["not-placed"]));
  assert.ok(!data.result_summary.includes("5 Sekunden"));
});

test("2: POSITIV-KONTROLLE - laufender Anruf behaelt den Bestandsplatzhalter", async () => {
  const data = await awaitCallEvent({ consultBody: RUNNING_CONSULT, callBody: null });

  assert.equal(data.status, null);
  assert.equal(data.failure_reason, null);
  assert.equal(data.result_summary, null);
});

test("3: terminaler Anruf OHNE Grund - result_summary bleibt byte-identisch zum Bestandsplatzhalter", async () => {
  const data = await awaitCallEvent({ consultBody: DONE_CONSULT, callBody: finishedCall({ failureReason: null }) });

  assert.equal(data.status, "failed");
  assert.equal(data.failure_reason, null);
  assert.equal(data.result_summary, AWAIT_SUMMARY_PLACEHOLDER);
});

test("4: D-5 unbekanntes Token - der Sammel-Satz erscheint, das Roh-Token NICHT im Nutzertext", async () => {
  const RAW_TOKEN = "brandneu-nie-gesehen:42";
  const data = await awaitCallEvent({
    consultBody: DONE_CONSULT,
    callBody: finishedCall({ failureReason: RAW_TOKEN }),
  });

  assert.equal(data.result_summary, MCP_TEXTS.de.callFailedSummary(RAW_TOKEN));
  assert.ok(!data.result_summary.includes("brandneu-nie-gesehen"));
  assert.ok(!data.result_summary.includes("42"));
  // P5b (O-13 Teil 2): das Maschinenfeld traegt seit dieser Phase nur noch das
  // Basis-Token (Datenminimierung) - das Detail bleibt am Datensatz/Log/Ausfallbericht,
  // nicht mehr im MCP-Feld.
  assert.equal(data.failure_reason, failureReasonBase(RAW_TOKEN));
  assert.ok(!data.failure_reason.includes("42"));
});

test("5: Sprache - de/fr/en liefern paarweise verschiedene result_summary, je mit ihrer eigenen Phrase", async () => {
  const reason = "not-placed:start-403";
  const de = await awaitCallEvent({ consultBody: DONE_CONSULT, callBody: finishedCall({ failureReason: reason }), language: "de" });
  const fr = await awaitCallEvent({ consultBody: DONE_CONSULT, callBody: finishedCall({ failureReason: reason }), language: "fr" });
  const en = await awaitCallEvent({ consultBody: DONE_CONSULT, callBody: finishedCall({ failureReason: reason }), language: "en" });

  assert.notEqual(de.result_summary, fr.result_summary);
  assert.notEqual(de.result_summary, en.result_summary);
  assert.notEqual(fr.result_summary, en.result_summary);
  assert.ok(de.result_summary.includes(FAILURE_REASON_TEXTS.de.phrases["not-placed"]));
  assert.ok(fr.result_summary.includes(FAILURE_REASON_TEXTS.fr.phrases["not-placed"]));
  assert.ok(en.result_summary.includes(FAILURE_REASON_TEXTS.en.phrases["not-placed"]));
});

test("6: Rueckwaertskompatibilitaet - pickTranscript ohne dritten Parameter bleibt byte-identisch", () => {
  const callWithReason = finishedCall({ failureReason: "not-placed:start-403", summary: null });
  const result = pickTranscript(CALL_ID, callWithReason);

  assert.equal(result.result_summary, AWAIT_SUMMARY_PLACEHOLDER);
  assert.deepEqual(Object.keys(result).sort(), [
    "call_id",
    "commitments",
    "counterparty_commitments",
    "next_step",
    "objective_achieved",
    "open_points",
    "outcome",
    "result_summary",
  ]);
});

test("6b: AWAIT_EVENT_OUTPUT-Kontrakt bleibt additiv - alle Bestandsfelder sind weiterhin da", async () => {
  const data = await awaitCallEvent({ consultBody: DONE_CONSULT, callBody: finishedCall({ failureReason: null }) });

  for (const field of [
    "event",
    "event_id",
    "questions",
    "result_summary",
    "objective_achieved",
    "outcome",
    "commitments",
    "counterparty_commitments",
    "open_points",
    "next_step",
  ]) {
    assert.ok(Object.hasOwn(data, field), `Bestandsfeld ${field} fehlt`);
  }
  // Additiv (NEU seit E3a), kein Feld entfaellt:
  assert.ok(Object.hasOwn(data, "status"));
  assert.ok(Object.hasOwn(data, "failure_reason"));
});

// P11/T1 (Review-Blocker Runde 2): MCP_CONSULT_INSTRUCTIONS trug bisher NULL
// Testabdeckung fuer den Wiederhol-Riegel - ein stiller Verlust dieses Satzes liesse
// das Modell einen not-placed-Anruf wiederholen, jedes Mal mit echten Anbieterkosten.
// Positiv-Kontrolle (Lehre pruefkommando-ohne-positiv-kontrolle): ein bekannter
// Bestandssatz muss ebenfalls gefunden werden, sonst zeigt "nichts gefunden" nur einen
// leeren String.
test("7: MCP_CONSULT_INSTRUCTIONS traegt den not-placed-Wiederhol-Riegel (mit Positiv-Kontrolle)", () => {
  assert.ok(
    MCP_CONSULT_INSTRUCTIONS.includes("await_call_event"),
    "Positiv-Kontrolle: bekannter Bestandssatz nicht gefunden - Pruefkommando taugt nichts"
  );
  assert.ok(
    MCP_CONSULT_INSTRUCTIONS.includes(NOT_PLACED),
    "das Basis-Token NOT_PLACED fehlt in der Instruktion"
  );
  assert.ok(
    MCP_CONSULT_INSTRUCTIONS.includes("Do NOT retry the call"),
    "die Nicht-Wiederholungs-Anweisung fehlt in der Instruktion"
  );
});
