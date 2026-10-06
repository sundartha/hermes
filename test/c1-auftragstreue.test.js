import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const CALL_ID = "call_c1";

const GOAL = "Paket-Lieferung auf Freitag verschieben";
const TRANSCRIPT = [
  { role: "agent", text: "Koennen wir die Lieferung auf Freitag verschieben?" },
  { role: "caller", text: "Ja, Freitag passt, erledigt." },
  { role: "agent", text: "Soll ich dazu einen Erinnerungstermin eintragen?" },
  { role: "caller", text: "Nein danke." },
];

const MOCK_DECISION = { summary: "Auftrag erfuellt.", actionItems: [], objective_achieved: true };

function anthropicMessage() {
  return {
    id: "msg_c1_mock",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text: JSON.stringify(MOCK_DECISION) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 30 },
  };
}

let server;
let lastRequest = null;
let systemPrompt, summarizeCall, store, LOCALES;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      lastRequest = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(anthropicMessage()));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-c1-key";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls: [seedCall({ id: CALL_ID, direction: "outbound", goal: GOAL, transcript: TRANSCRIPT })],
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  ({ systemPrompt, summarizeCall } = await import("../src/claude.js"));
  ({ LOCALES } = await import("../src/i18n/locales.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

test("systemPrompt outbound de fuehrt Auftrag-zuerst + hoeflichen Abschluss", () => {
  const prompt = systemPrompt(store.getCall(CALL_ID));
  assert.ok(prompt.includes("Erledige zuerst den AUFTRAG"), "Auftrag-zuerst fehlt");
  assert.ok(prompt.includes("schließe höflich ab"), "hoeflicher Abschluss fehlt");
  assert.ok(
    prompt.includes("Lass den Anruf nie an einem Nebenthema hängen, das du selbst eröffnet hast."),
    "Nebenthema-Fuehrung fehlt",
  );
});

test("systemPrompt outbound de lockert den Scope-Guard, behaelt aber die Wait-Sicherung", () => {
  const prompt = systemPrompt(store.getCall(CALL_ID));
  assert.ok(
    !prompt.includes("Sage nichts zu, was ausserhalb deines Auftrags liegt"),
    "harter Scope-Guard darf nicht mehr im Prompt stehen",
  );
  assert.ok(
    prompt.includes("Warte nach deinem Anliegen IMMER auf die Antwort des Angerufenen"),
    "Wait-for-answer-Sicherung muss erhalten bleiben",
  );
});

test("summarizeCall mappt objective_achieved trotz abgebrochenem Folge-Subdialog auf true", async () => {
  const call = store.getCall(CALL_ID);
  await summarizeCall(call);
  assert.equal(call.objectiveAchieved, true);
});

test("summarizeCall sendet den auftrags-gebundenen Summary-Prompt ans Modell", async () => {
  await summarizeCall(store.getCall(CALL_ID));
  assert.ok(lastRequest.system.includes("AUSSCHLIESSLICH"), "Auftrags-Bindung fehlt im Prompt");
  assert.ok(lastRequest.system.includes("IRRELEVANT"), "Nebenthema-Regel fehlt im Prompt");
});

test("Cross-Locale: jede Sprache markiert Nebenthemen als irrelevant + behaelt die JSON-Keys", () => {
  for (const lang of ["de", "fr", "en"]) {
    const sys = LOCALES[lang].summarySystem(OWNER);
    assert.match(sys, /IRRELEVANT|SANS PERTINENCE/, `${lang}: Nebenthema-Marker fehlt`);
    for (const key of [
      '"summary"',
      '"actionItems"',
      '"objective_achieved"',
      '"outcome"',
      '"commitments"',
      '"counterparty_commitments"',
      '"open_points"',
      '"next_step"',
      '"facts"',
    ]) {
      assert.ok(sys.includes(key), `${lang}: JSON-Key ${key} fehlt`);
    }
  }
});
