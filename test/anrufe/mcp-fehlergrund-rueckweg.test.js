import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools, pickTranscript } from "../../src/mcp-tools.js";
import { FAILURE_REASON_TEXTS } from "../../src/i18n/failure-reason-texts.js";
import { MCP_TEXTS } from "../../src/i18n/mcp-texts.js";
import { MCP_CONSULT_INSTRUCTIONS } from "../../src/mcp-server-info.js";
import { NOT_PLACED, failureReasonBase } from "../../src/telephony/failure-reason.js";

const CALL_ID = "call_p2a";
const AWAIT_SUMMARY_PLACEHOLDER =
  "(Noch keine Zusammenfassung verfuegbar - ggf. 5 Sekunden warten und erneut aufrufen.)";
const HTTP_OK = 200;

function captureTools(ctx) {
  const handlers = new Map();
  const fakeServer = {
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return handlers;
}

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
  assert.ok(Object.hasOwn(data, "status"));
  assert.ok(Object.hasOwn(data, "failure_reason"));
});

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

test("8: abgeschlossener Anruf ohne Zusammenfassung zeigt den Warte-Platzhalter der Sprache, nicht den Fehlschlag-Satz", () => {
  const completedCall = finishedCall({ status: "completed", summary: null, failureReason: null });

  const result = pickTranscript(CALL_ID, completedCall, MCP_TEXTS.en);

  assert.equal(result.result_summary, MCP_TEXTS.en.awaitSummary);
  assert.notEqual(result.result_summary, MCP_TEXTS.en.callFailedSummary(null));
});

test("8b: abgeschlossener Anruf mit Fehlergrund ohne Zusammenfassung zeigt den Warte-Platzhalter, nicht den Fehlschlag-Satz", () => {
  const budgetEndedCall = finishedCall({ status: "completed", summary: null, failureReason: "budget-exhausted" });

  const result = pickTranscript(CALL_ID, budgetEndedCall, MCP_TEXTS.de);

  assert.equal(result.result_summary, MCP_TEXTS.de.awaitSummary);
  assert.notEqual(result.result_summary, MCP_TEXTS.de.callFailedSummary("budget-exhausted"));
});

test("9: Anruf ohne Zielangabe meldet objective_achieved als unclear", () => {
  const callWithoutObjective = finishedCall({ status: "completed", objectiveAchieved: undefined });

  const result = pickTranscript(CALL_ID, callWithoutObjective, MCP_TEXTS.de);

  assert.equal(result.objective_achieved, "unclear");
});

const SECRET_CARD = "4111 1111 1111 1111";
const SECRET_GOVERNMENT_ID = "L01X00T47";
const SECRET_PIN = "4711";
const RECORDING_URL = "https://media.example.invalid/aufnahme-p2a.mp3";
const AUDIO_PAYLOAD = "UklGRiQAAABXQVZFZm10";
const FIRST_TRANSCRIPT_TEXT = "Allererste Zeile ganz am Anfang";
const STATUS_LINE_LIMIT = 6;

function callWithRestrictedData() {
  const transcript = [
    { role: "agent", text: FIRST_TRANSCRIPT_TEXT },
    { role: "counterparty", text: "Zweite Zeile" },
    { role: "agent", text: "Dritte Zeile" },
    { role: "counterparty", text: "Vierte Zeile" },
    { role: "agent", text: "Fuenfte Zeile" },
    { role: "counterparty", text: "Sechste Zeile" },
    { role: "agent", text: `Karte ${SECRET_CARD} notiert` },
    { role: "counterparty", text: `PIN ist ${SECRET_PIN}` },
  ];
  return {
    status: "completed",
    startedAt: "2026-11-04T10:00:00.000Z",
    endedAt: "2026-11-04T10:02:00.000Z",
    answeredAt: "2026-11-04T10:00:05.000Z",
    transcript,
    summary: `Zahlung mit Karte ${SECRET_CARD} vereinbart`,
    objectiveAchieved: "yes",
    failureReason: null,
    recordingUrl: RECORDING_URL,
    audio: AUDIO_PAYLOAD,
    result: {
      outcome: `Personalausweisnummer ${SECRET_GOVERNMENT_ID} hinterlegt`,
      commitments: [`Karte ${SECRET_CARD} wird belastet`],
      counterpartyCommitments: [`PIN ist ${SECRET_PIN}`],
      openPoints: [`Personalausweisnummer ${SECRET_GOVERNMENT_ID} pruefen`],
      nextStep: `Karte ${SECRET_CARD} erneut nennen`,
    },
  };
}

async function runToolAgainstCall(toolName, args) {
  return withGateway({ consultBody: DONE_CONSULT, callBody: callWithRestrictedData() }, async () => {
    const handlers = captureTools({ identity: null, scopedTenant: "tenant_p2a", consultAllowed: true, language: "de" });
    return handlers.get(toolName)(args);
  });
}

function assertNoRawTranscriptAudioOrSecrets(result) {
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(SECRET_CARD), "Kartennummer unmaskiert in der Antwort");
  assert.ok(!serialized.includes(SECRET_GOVERNMENT_ID), "Kennnummer unmaskiert in der Antwort");
  assert.ok(!serialized.includes(`PIN ist ${SECRET_PIN}`), "Zugangsdaten unmaskiert in der Antwort");
  assert.ok(!serialized.includes(RECORDING_URL), "Aufnahme-Adresse in der Antwort");
  assert.ok(!serialized.includes(AUDIO_PAYLOAD), "Audio in der Antwort");
  assert.ok(!serialized.includes(FIRST_TRANSCRIPT_TEXT), "Rohtranskript in der Antwort");
  assert.ok(!Object.hasOwn(result.structuredContent, "transcript"));
}

function assertMaskedSummaryAndCard(data) {
  assert.equal(data.result_summary, "Zahlung mit Karte ****1111 vereinbart");
  assert.ok(data.outcome.includes("[restricted-government-id]"));
  assert.deepEqual(data.commitments, ["Karte ****1111 wird belastet"]);
  assert.ok(data.counterparty_commitments[0].includes("[restricted-credential]"));
  assert.ok(data.open_points[0].includes("[restricted-government-id]"));
  assert.equal(data.next_step, "Karte ****1111 erneut nennen");
}

test("[NIE1] get_call_result liefert kein Rohtranskript und kein Audio und maskiert Zusammenfassung und Ergebniskarte", async () => {
  const result = await runToolAgainstCall("get_call_result", { call_id: CALL_ID });

  assertNoRawTranscriptAudioOrSecrets(result);
  assertMaskedSummaryAndCard(result.structuredContent);
});

test("[NIE1] await_call_event liefert kein Rohtranskript und kein Audio und maskiert Zusammenfassung und Ergebniskarte", async () => {
  const result = await runToolAgainstCall("await_call_event", { call_id: CALL_ID, after_event_id: undefined });

  assertNoRawTranscriptAudioOrSecrets(result);
  assert.equal(result.structuredContent.event, "done");
  assertMaskedSummaryAndCard(result.structuredContent);
});

test("[NIE1] get_call_status zeigt nur die letzten sechs Transkriptzeilen, maskiert und ohne Audio", async () => {
  const result = await runToolAgainstCall("get_call_status", { call_id: CALL_ID });

  assertNoRawTranscriptAudioOrSecrets(result);
  assert.equal(result.structuredContent.status, "completed");
  assert.equal(result.structuredContent.failure_reason, null);
  const lines = result.structuredContent.last_transcript_lines;
  assert.equal(lines.length, STATUS_LINE_LIMIT);
  assert.equal(lines[0], "Agent: Dritte Zeile");
  assert.ok(!JSON.stringify(result).includes("Zweite Zeile"), "mehr als sechs Transkriptzeilen");
  assert.equal(lines[STATUS_LINE_LIMIT - 2], "Agent: Karte ****1111 notiert");
  assert.ok(lines[STATUS_LINE_LIMIT - 1].startsWith("Gegenseite: "));
  assert.ok(lines[STATUS_LINE_LIMIT - 1].includes("[restricted-credential]"));
});
