// Phase C1 (Auftragstreue): der Outbound-System-Prompt stellt den AUFTRAG voran
// (Folgeschritte erst danach, kein harter Verbots-Scope-Guard) und der
// Zusammenfassungs-Prompt verankert objective_achieved AUSSCHLIESSLICH am
// urspruenglichen Auftrag - vom Assistenten eroeffnete Nebenthemen bleiben fuer die
// Bewertung irrelevant. Geprueft werden (i) die String-Verankerung in Code + 3 Locales,
// (ii) dass die auftrags-gebundene Bindung tatsaechlich ans Modell geht, (iii) das
// Wert-Mapping objective_achieved -> objectiveAchieved.
//
// Rein in-process (kein Server-Spawn, kein pglite) - dieselbe Naht wie
// f1-i18n-locale/personal-assistant-characterization: ANTHROPIC_BASE_URL + DATA_DIR vor
// dem ersten config-Import setzen, dann dynamischer Import der reinen Funktionen. Der
// lokale HTTP-Mock ersetzt den Anthropic-Endpunkt (das SDK liest ANTHROPIC_BASE_URL)
// und merkt sich den letzten Request-Body fuer das Prompt-Grounding.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const CALL_ID = "call_c1";

// Auftrag + Transkript: der Auftrag wurde beantwortet ("Ja, Freitag passt, erledigt."),
// danach eroeffnet der Assistent einen Folge-Subdialog (Erinnerungstermin), den das
// Gegenueber abbricht ("Nein danke."). Genau der Fall, in dem objective_achieved=true
// gelten soll, obwohl der Anruf in einem Nebenthema endet.
const GOAL = "Paket-Lieferung auf Freitag verschieben";
const TRANSCRIPT = [
  { role: "agent", text: "Koennen wir die Lieferung auf Freitag verschieben?" },
  { role: "caller", text: "Ja, Freitag passt, erledigt." },
  { role: "agent", text: "Soll ich dazu einen Erinnerungstermin eintragen?" },
  { role: "caller", text: "Nein danke." },
];

// Das Modell antwortet mit genau dieser auftragsbezogenen Bewertung (objective_achieved
// trotz abgebrochenem Nebenthema true) - so prueft Test 3 das Wert-Mapping deterministisch.
const MOCK_DECISION = { summary: "Auftrag erfuellt.", actionItems: [], objective_achieved: true };

// Vollstaendige, minimale Anthropic-Message; content[0].text traegt die JSON-Decision.
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
  // Lokaler Anthropic-Mock: draint den Body, merkt sich den geparsten Request (Prompt-
  // Grounding) und antwortet mit einer validen Message. Pfad-agnostisch (das SDK postet
  // an /v1/messages); wir brauchen nur die eine Decision zurueck.
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

  // Env VOR dem ersten config-Import: Base-URL auf den Mock, ein Dummy-Key (das SDK
  // braucht ihn, um ueberhaupt einen Request zu stellen), DATA_DIR auf den Seed-Store.
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
  assert.ok(prompt.includes("schliesse hoeflich ab"), "hoeflicher Abschluss fehlt");
  assert.ok(
    prompt.includes("lass den Anruf nie an einem selbst eroeffneten Nebenthema haengen"),
    "Nebenthema-Fuehrung fehlt",
  );
});

test("systemPrompt outbound de lockert den Scope-Guard, behaelt aber die Wait-Sicherung", () => {
  const prompt = systemPrompt(store.getCall(CALL_ID));
  // Owner-Entscheidung #1: kein harter Verbots-Scope-Guard mehr (Folgeschritte erlaubt).
  assert.ok(
    !prompt.includes("Sage nichts zu, was ausserhalb deines Auftrags liegt"),
    "harter Scope-Guard darf nicht mehr im Prompt stehen",
  );
  // G2/T1-Sicherung byte-stabil: nie auflegen, bevor das Gegenueber geantwortet hat.
  assert.ok(
    prompt.includes("lege niemals auf, bevor er geantwortet hat"),
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
    for (const key of ['"summary"', '"actionItems"', '"objective_achieved"']) {
      assert.ok(sys.includes(key), `${lang}: JSON-Key ${key} fehlt`);
    }
  }
});
