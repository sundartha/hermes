// AL-P11 (Ergebnis-Karte statt Prosa): normalizeCallResult/evidenceRetentionEnabled/
// stripResultEvidence (rein, offline), summarizeCall-Additivitaet + Evidence-Prompt-
// Kopplung (gemockter Anthropic-Endpunkt, Muster c1-auftragstreue.test.js),
// purgeExpiredResultEvidence + pruneOldData-Komposition, json/pg-Durchstich, MCP-
// Whitelist (kein facts/evidence-Leak), SMS-Fallback. Kein Netz, kein echter Anruf.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  RESULT_LIST_MAX_ITEMS,
  RESULT_TEXT_MAX_CHARS,
  RESULT_EVIDENCE_MAX_ITEMS,
  RESULT_EVIDENCE_MAX_CHARS,
  evidenceRetentionEnabled,
  normalizeCallResult,
  stripResultEvidence,
} from "../src/call-result.js";
import { purgeExpiredResultEvidence, pruneOldData } from "../src/store/state-ops.js";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
// AL-P11: pg-helpers.js importiert (transitiv ueber src/store/pg.js) config.js statisch -
// das MUSS NACH dem DATA_DIR-Set im before()-Hook passieren (Repo-Regel, Lehre
// test-base-env-drift), deshalb hier bewusst dynamisch statt am Datei-Kopf importiert.

const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

// ---- Block 1: normalizeCallResult (rein, Grenzfaelle) ----

test("AL-P11-1: Modell-Antwort ohne die neuen Keys -> normalizeCallResult(...) === null (byte-identische Persistenz)", () => {
  const parsed = { summary: "Kurz.", actionItems: [], objective_achieved: true };
  assert.equal(normalizeCallResult(parsed, { evidenceAllowed: false }), null);
});

test("AL-P11-2: Kappung auf 3 Listeneintraege / 200 Zeichen / [] bei Nicht-Array", () => {
  const longOutcome = "x".repeat(400);
  const parsed = {
    outcome: longOutcome,
    commitments: ["a", "b", "c", "d", "e"],
    open_points: "kein Array",
  };
  const card = normalizeCallResult(parsed, { evidenceAllowed: false });
  assert.equal(card.outcome.length, RESULT_TEXT_MAX_CHARS);
  assert.equal(card.commitments.length, RESULT_LIST_MAX_ITEMS);
  assert.deepEqual(card.commitments, ["a", "b", "c"]);
  assert.deepEqual(card.openPoints, []);
});

test("AL-P11-3: evidenceAllowed=false + 4 Zitate im Modell-Output -> KEIN evidence-Key im Ergebnis (O5-Riegel)", () => {
  const parsed = {
    outcome: "Termin vereinbart.",
    evidence: ["Zitat 1", "Zitat 2", "Zitat 3", "Zitat 4"],
  };
  const card = normalizeCallResult(parsed, { evidenceAllowed: false });
  assert.ok(!("evidence" in card), "evidence darf bei evidenceAllowed=false gar nicht existieren");
});

test("AL-P11-4: evidenceAllowed=true + 4 Zitate -> genau 2, je <= 160 Zeichen (O5-Obergrenze)", () => {
  const parsed = {
    outcome: "Termin vereinbart.",
    evidence: ["Zitat 1", "Zitat 2", "Zitat 3", "Zitat 4"],
  };
  const card = normalizeCallResult(parsed, { evidenceAllowed: true });
  assert.equal(card.evidence.length, RESULT_EVIDENCE_MAX_ITEMS);
  assert.deepEqual(card.evidence, ["Zitat 1", "Zitat 2"]);
  assert.ok(card.evidence.every((e) => e.length <= RESULT_EVIDENCE_MAX_CHARS));
});

test("AL-P11-5: evidenceRetentionEnabled(privacy) spiegelt evidenceRetentionDays > 0", () => {
  assert.equal(evidenceRetentionEnabled({ evidenceRetentionDays: 0 }), false);
  assert.equal(evidenceRetentionEnabled({ evidenceRetentionDays: 7 }), true);
});

// ---- Block 2: summarizeCall (gemockter Anthropic-Endpunkt, Muster c1-auftragstreue) ----

const CALL_ID = "call_al_p11";
const OWNER = "Jonas Beispiel";
const GOAL = "Termin fuer eine Beratung vereinbaren";
const TRANSCRIPT = [
  { role: "agent", text: "Koennen wir einen Beratungstermin vereinbaren?" },
  { role: "caller", text: "Ja, Dienstag 14 Uhr passt." },
];
const MOCK_DECISION_WITH_CARD = {
  summary: "Termin vereinbart.",
  actionItems: [],
  objective_achieved: true,
  outcome: "Termin am Dienstag um 14 Uhr vereinbart.",
  commitments: ["Termin bestaetigt"],
  counterparty_commitments: [],
  open_points: [],
  next_step: null,
  facts: [],
  evidence: ["Dienstag 14 Uhr passt."],
};

function anthropicMessage(decision) {
  return {
    id: "msg_al_p11_mock",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text: JSON.stringify(decision) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 30 },
  };
}

let server;
let lastRequest = null;
let mockDecision = MOCK_DECISION_WITH_CARD;
let summarizeCall, store, configModule;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      lastRequest = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(anthropicMessage(mockDecision)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-al-p11-key";
  // AL-P11-10 (json-Durchstich) braucht einen ZWEITEN, unberuehrten Call OHNE result-Feld
  // im selben Seed - json.js' load() cached sein state-Objekt ab dem ersten Aufruf fuer
  // die Lebensdauer des Prozesses (Repo-Regel: EIN DATA_DIR pro Testdatei), ein zweiter
  // DATA_DIR waere in dieser Datei nicht mehr wirksam.
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls: [
        seedCall({ id: CALL_ID, direction: "outbound", goal: GOAL, transcript: TRANSCRIPT }),
        seedCall({ id: "call_json_migration" }),
      ],
    }),
  );
  configModule = await import("../src/config.js");
  store = await import("../src/store.js");
  ({ summarizeCall } = await import("../src/claude.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

test("AL-P11-6: summarizeCall setzt call.result additiv, laesst summary/objectiveAchieved unveraendert", async () => {
  mockDecision = MOCK_DECISION_WITH_CARD;
  const call = store.getCall(CALL_ID);
  await summarizeCall(call);
  assert.equal(call.summary, "Termin vereinbart.");
  assert.equal(call.objectiveAchieved, true);
  assert.ok(call.result, "call.result muss gesetzt sein");
  assert.equal(call.result.outcome, "Termin am Dienstag um 14 Uhr vereinbart.");
  assert.deepEqual(call.result.commitments, ["Termin bestaetigt"]);
});

test("AL-P11-7: EVIDENCE_RETENTION_DAYS steuert die Zitat-Klausel im gesendeten Prompt", async () => {
  const call = store.getCall(CALL_ID);
  const originalDays = configModule.config.privacy.evidenceRetentionDays;

  configModule.config.privacy.evidenceRetentionDays = 0;
  await summarizeCall(call);
  assert.ok(
    !lastRequest.system.includes("evidence"),
    "bei evidenceRetentionDays=0 darf die Zitat-Klausel nicht im Prompt stehen",
  );

  configModule.config.privacy.evidenceRetentionDays = 7;
  await summarizeCall(call);
  assert.ok(
    lastRequest.system.includes("evidence"),
    "bei evidenceRetentionDays=7 muss die Zitat-Klausel im Prompt stehen",
  );

  configModule.config.privacy.evidenceRetentionDays = originalDays;
});

// ---- Block 3: purgeExpiredResultEvidence + pruneOldData-Komposition (rein) ----

test("AL-P11-8: purgeExpiredResultEvidence entfernt nur evidence, behaelt outcome/facts; laufender Call unberuehrt; days=0 -> alles faellt", () => {
  const s = {
    calls: [
      {
        id: "c_old",
        endedAt: daysAgo(10),
        result: { outcome: "Termin fest.", facts: ["Preis 55 EUR"], evidence: ["woertliches Zitat"] },
      },
      {
        id: "c_active",
        endedAt: null,
        result: { outcome: "laeuft noch", evidence: ["woertliches Zitat"] },
      },
    ],
  };
  const purged = purgeExpiredResultEvidence(s, 7);
  assert.equal(purged, 1, "genau der beendete Alt-Call zaehlt");
  assert.ok(!("evidence" in s.calls[0].result), "evidence ist weg");
  assert.equal(s.calls[0].result.outcome, "Termin fest.", "outcome bleibt stehen");
  assert.deepEqual(s.calls[0].result.facts, ["Preis 55 EUR"], "facts bleiben stehen");
  assert.ok("evidence" in s.calls[1].result, "laufender Call bleibt unberuehrt");

  const sZero = {
    calls: [{ id: "c_fresh", endedAt: daysAgo(1), result: { outcome: "x", evidence: ["z"] } }],
  };
  const purgedZero = purgeExpiredResultEvidence(sZero, 0);
  assert.equal(purgedZero, 1, "days=0 = Feature aus -> jedes beendete Zitat faellt sofort");
});

test("AL-P11-9: pruneOldData komponiert DREI Durchgaenge (resultEvidence-Zaehler), auch bei retentionDays=0", () => {
  const s = {
    calls: [
      {
        id: "c1",
        status: "completed",
        endedAt: daysAgo(10),
        result: { outcome: "x", evidence: ["z"] },
        diagnostic: false,
        transcript: [],
      },
    ],
    notifications: [],
    actionItems: [],
  };
  const removed = pruneOldData(s, { retentionDays: 0, diagnosticRetentionDays: 0, evidenceRetentionDays: 7 });
  assert.equal(removed.resultEvidence, 1, "die kuerzeste Frist wirkt unabhaengig von retentionDays=0");
  assert.equal(s.calls.length, 1, "der Call-Record selbst bleibt (retentionDays=0 = Retention aus)");
});

// ---- Block 4: json-Durchstich (Migration + Persistenz) ----
// Nutzt bewusst denselben store/DATA_DIR wie Block 2 (s. before()-Kommentar oben) statt
// eines zweiten DATA_DIR - json.js' load() cached seinen state fuer die Prozesslaufzeit.

test("AL-P11-10a: Bestands-Call (aus seedCall, ohne result-Feld) migriert beim ersten load() auf result===null", () => {
  const migrated = store.getCall("call_json_migration");
  assert.equal(migrated.result, null, "Bestands-Call ohne result-Feld migriert auf null");
});

test("AL-P11-10b: result ueberlebt save() - auf Platte gelesen (store.json), nicht nur im Speicher", async () => {
  const fs = await import("fs");
  const path = await import("path");
  const migrated = store.getCall("call_json_migration");
  migrated.result = {
    outcome: "Termin fest.",
    commitments: [],
    counterpartyCommitments: [],
    openPoints: [],
    nextStep: null,
    facts: [],
  };
  store.save();

  const onDisk = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, "store.json"), "utf8"));
  const onDiskCall = onDisk.calls.find((c) => c.id === "call_json_migration");
  assert.equal(onDiskCall.result.outcome, "Termin fest.", "result ist auf Platte persistiert");
});

// ---- Block 5: pg-Durchstich (pglite, i8-Lehre: ON CONFLICT DO UPDATE SET) ----

test("AL-P11-11: pg-Durchstich - result ueberlebt die Re-Hydrierung UND einen zweiten Flush", async () => {
  const { makePgTestStore } = await import("./pg-helpers.js");
  const { store: pgStore, db } = await makePgTestStore();
  const call = pgStore.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  const ref = pgStore.getCall(call.id);
  ref.result = { outcome: "Termin fest.", commitments: [], counterpartyCommitments: [], openPoints: [], nextStep: null, facts: [] };
  await pgStore.save();

  const runner1 = { withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }) };
  const { makePgStore } = await import("../src/store/pg.js");
  const reopened1 = makePgStore(runner1);
  await reopened1.init();
  assert.equal(reopened1.getCall(call.id).result.outcome, "Termin fest.", "result ueberlebt die erste Re-Hydrierung");

  // Zweiter Flush OHNE result-Aenderung: die i8-Falle waere, dass result NICHT im
  // ON CONFLICT DO UPDATE SET steht und dadurch auf NULL zurueckfaellt.
  reopened1.getCall(call.id).twilioSid = "CA-al-p11";
  await reopened1.save();

  const runner2 = { withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }) };
  const reopened2 = makePgStore(runner2);
  await reopened2.init();
  assert.equal(
    reopened2.getCall(call.id).result.outcome,
    "Termin fest.",
    "result ueberlebt auch den zweiten Flush (ON CONFLICT DO UPDATE SET)",
  );
});

// ---- Block 6: MCP-Whitelist (E2, kein facts/evidence-Leak) ----

test("AL-P11-12: get_transcript structuredContent traegt die fuenf Karten-Felder, NICHT facts/evidence", async () => {
  const { registerTools } = await import("../src/mcp-tools.js");
  const RICH_TRANSCRIPT = {
    status: "completed",
    transcript: [{ role: "agent", text: "x" }],
    summary: "Termin vereinbart.",
    objectiveAchieved: true,
    result: {
      outcome: "Termin am Dienstag um 14 Uhr vereinbart.",
      commitments: ["Termin bestaetigt"],
      counterpartyCommitments: ["Ruft zurueck"],
      openPoints: ["Preis unklar"],
      nextStep: "Kalender eintragen",
      facts: ["Werkstatt oeffnet um 8 Uhr"],
      evidence: ["woertliches Zitat der Gegenstelle"],
    },
  };
  const gwServer = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(RICH_TRANSCRIPT));
  });
  await new Promise((r) => gwServer.listen(0, "127.0.0.1", r));
  const prevGatewayUrl = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${gwServer.address().port}`;
  try {
    const tools = new Map();
    const fakeServer = {
      tool(name, desc, _schema, handler) {
        tools.set(name, { handler });
      },
      registerTool(name, config, handler) {
        tools.set(name, { config, handler });
      },
      registerResource() {},
    };
    registerTools(fakeServer, undefined);
    const { handler } = tools.get("get_transcript");
    const result = await handler({ call_id: "call_1" });

    assert.deepEqual(Object.keys(result.structuredContent).sort(), [
      "call_id",
      "commitments",
      "counterparty_commitments",
      "next_step",
      "objective_achieved",
      "open_points",
      "outcome",
      "result_summary",
    ]);
    assert.equal(result.structuredContent.outcome, "Termin am Dienstag um 14 Uhr vereinbart.");
    assert.equal(result.structuredContent.next_step, "Kalender eintragen");

    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("woertliches Zitat der Gegenstelle"), "kein evidence-Leak");
    assert.ok(!serialized.includes("Werkstatt oeffnet um 8 Uhr"), "kein facts-Leak");
  } finally {
    if (prevGatewayUrl === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prevGatewayUrl;
    await new Promise((r) => gwServer.close(r));
  }
});

// ---- Block 7: SMS-Fallback (call-finish.js, Muster web-14-call-finish-sms-text-language) ----

function makeFakeCallFinishStore(notifyCapture) {
  return {
    withStoreLock: (fn) => fn(),
    releaseOutboundReserve: async () => {},
    save: () => {},
    addNotification: (title, body, callId) => notifyCapture.push({ title, body, callId }),
    purgeTranscript: () => {},
    tenantContext: () => ({ settings: { agentName: "Hermes" } }),
    recordUsageEvent: () => {},
    markSummarySmsSent: () => {},
    markBilled: () => {},
  };
}

async function runFinishCallForSms(call, summaryResult) {
  const { makeCallFinish } = await import("../src/telephony/call-finish.js");
  const smsCapture = [];
  const notifyCapture = [];
  const callFinish = makeCallFinish({
    store: makeFakeCallFinishStore(notifyCapture),
    config: { billing: { paymentEnabled: false, smsCostCents: 0 }, privacy: {} },
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async ({ body }) => smsCapture.push(body) }),
    summarizeCall: async () => summaryResult,
    planSummarySms: () => ({
      send: true,
      to: "+12025550199",
      smsFrom: { e164: "+12025550001" },
      reason: null,
    }),
    audit: () => {},
  });
  await callFinish.finishCall(call);
  return smsCapture;
}

test("AL-P11-13a: ohne call.result faellt die SMS auf die Summary zurueck (Bestandsverhalten)", async () => {
  const call = seedCall({
    direction: "outbound",
    status: "completed",
    to: "+12025550123",
    transcript: [{ role: "caller", text: "Hi", at: "2026-01-01T00:00:00Z" }],
  });
  call.result = null;
  const smsCapture = await runFinishCallForSms(call, { summary: "Fallback-Summary.", actionItems: [] });
  assert.equal(smsCapture.length, 1);
  assert.match(smsCapture[0], /Fallback-Summary\./);
});

test("AL-P11-13b: mit call.result.outcome steht dieser (nicht die Summary) im SMS-Body", async () => {
  const call = seedCall({
    direction: "outbound",
    status: "completed",
    to: "+12025550123",
    transcript: [{ role: "caller", text: "Hi", at: "2026-01-01T00:00:00Z" }],
  });
  call.result = { outcome: "Termin fest vereinbart." };
  const smsCapture = await runFinishCallForSms(call, { summary: "Sollte nicht erscheinen.", actionItems: [] });
  assert.equal(smsCapture.length, 1);
  assert.match(smsCapture[0], /Termin fest vereinbart\./);
  assert.doesNotMatch(smsCapture[0], /Sollte nicht erscheinen\./);
});
