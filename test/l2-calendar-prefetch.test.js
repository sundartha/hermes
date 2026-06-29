// Phase L2 (Kalender-Prefetch): der Outbound-System-Prompt bettet den Kalender-Auszug
// des Auftraggebers vorab ein (gegated am allowCalendar-Gate), damit das Modell freie
// Slots vor dem ersten Wort kennt und get_calendar im Buchungs-Normalfall nicht erst
// mid-turn aufrufen muss. get_calendar bleibt als Fallback registriert. Geprueft werden
// (1) das Prompt-Grounding, (2) die G5-Single-Source-Konsistenz Tool<->Prompt (TZ-robust),
// (3) der Inbound-Skip, (4) das fail-closed Gate (allowCalendar=false -> kein Block, kein
// Tool), (5) die Roundtrip-Reduktion (Slots liegen vorab im System-Prompt, EIN Roundtrip
// ohne get_calendar) und (6) die Unversehrtheit des Offenlegungssatzes.
//
// Beide Engines konsumieren dasselbe systemPrompt/toolDefs: die Realtime-Bridge ruft
// instructions()->systemPrompt(call) und realtimeTools()->toolDefs(tenantId), ohne
// kalenderspezifische Verzweigung -> die Einbettung greift identisch (kein separater
// Test, da instructions()/realtimeTools modul-lokal und nicht exportiert sind).
//
// Rein in-process (kein Server-Spawn, kein pglite) - dieselbe Naht wie c1-auftragstreue:
// ANTHROPIC_BASE_URL + DATA_DIR vor dem ersten config-Import, dann dynamischer Import der
// reinen Funktionen. Der lokale HTTP-Mock ersetzt den Anthropic-Endpunkt (das SDK liest
// ANTHROPIC_BASE_URL), zaehlt Requests und merkt sich den letzten system-Prompt.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const CALL_ID = "call_l2";
const T_NOCAL = "nocal";
const EVENT_TITLE = "Zahnarzt";

// Offenlegungs-Wortlaut (de, voller ownerName) - byte-identisch zu disclosure-regression/
// personal-assistant-characterization: belegt, dass die Einbettung ihn nicht beruehrt.
const DISCLOSURE_DE = `Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas Beispiel. Das Gespraech wird fuer meinen Auftraggeber zusammengefasst.`;

// Vollstaendige, minimale Anthropic-Message ohne tool_use: das Modell antwortet rein
// textlich, der Tool-Loop bricht nach EINEM Roundtrip ab (Test 5).
function anthropicMessage() {
  return {
    id: "msg_l2_mock",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text: "Freitag 14 Uhr passt." }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

let server;
let reqCount = 0;
let lastSystem = null;
let systemPrompt, execTool, agentTurn, disclosureSentence, toolDefs, store;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      reqCount += 1;
      lastSystem = JSON.parse(body).system;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(anthropicMessage()));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-l2-key";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [
        { id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER },
        { id: T_NOCAL, status: "active", ownerName: OWNER },
      ],
      calls: [seedCall({ id: CALL_ID, direction: "outbound", goal: "Termin verschieben" })],
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  ({ systemPrompt, execTool, agentTurn, disclosureSentence, toolDefs } = await import(
    "../src/claude.js"
  ));

  // Kalender ueber den Produktionspfad seeden (kein Map-Bypass); Datums-Strings beliebig,
  // die Assertions sind TZ-unabhaengig (nur Titel + Formatter-Konsistenz, kein Datums-Pin).
  store.addCalendarEvent(
    BOOTSTRAP_TENANT_ID,
    EVENT_TITLE,
    "2026-07-03T14:00:00.000Z",
    "2026-07-03T15:00:00.000Z",
  );
  // Fail-closed-Tenant: Kalenderzugriff aus (ueber den echten Setter, kein Map-Bypass).
  store.updateSettings(T_NOCAL, { allowCalendar: false });
});

after(async () => {
  await new Promise((r) => server.close(r));
});

const ownerCall = (over = {}) => seedCall({ tenantId: BOOTSTRAP_TENANT_ID, ...over });
const HEADER = "KALENDER DEINES AUFTRAGGEBERS";

test("1 Prompt-Grounding: outbound-systemPrompt traegt Kalender-Header + Event-Titel", () => {
  const prompt = systemPrompt(ownerCall({ direction: "outbound" }));
  assert.ok(prompt.includes(HEADER), "Kalender-Header fehlt im Outbound-Prompt");
  assert.ok(prompt.includes(EVENT_TITLE), "geseedeter Event-Titel fehlt im Prompt");
});

test("2 G5 Single-Source: exakt die get_calendar-Ausgabe ist eingebettet (TZ-robust)", () => {
  const call = ownerCall({ direction: "outbound" });
  const excerpt = execTool(call, "get_calendar", {});
  // Beweist, dass Tool UND Prompt denselben Formatter nutzen (inkl. TZ-korrekter
  // Datumsformatierung) - keine harten Datums-Strings, fmtDate ist TZ-abhaengig.
  assert.ok(systemPrompt(call).includes(excerpt), "Prompt enthaelt die Tool-Ausgabe nicht 1:1");
});

test("3 Scope: Inbound-Prompt traegt den Kalender-Header NICHT", () => {
  const prompt = systemPrompt(ownerCall({ direction: "inbound" }));
  assert.ok(!prompt.includes(HEADER), "Inbound-Prompt darf keinen Kalender-Block tragen");
});

test("4 Gate fail-closed: allowCalendar=false -> kein Block + kein get_calendar-Tool", () => {
  const prompt = systemPrompt(seedCall({ tenantId: T_NOCAL, direction: "outbound" }));
  assert.ok(!prompt.includes(HEADER), "ohne Kalenderzugriff darf kein Block eingebettet sein");
  assert.ok(
    !toolDefs(T_NOCAL).some((t) => t.name === "get_calendar"),
    "ohne Kalenderzugriff darf get_calendar nicht registriert sein",
  );
});

test("5 Roundtrip-Reduktion: ein agentTurn ohne zweiten get_calendar-Roundtrip", async () => {
  const call = store.getCall(CALL_ID);
  const before = reqCount;
  await agentTurn(call, "Haben Sie Freitag 14 Uhr frei?");
  // Deterministisch belegt: die Slots liegen vorab im System-Block (lastSystem[0].text) und
  // EIN Roundtrip genuegte (kein mid-turn get_calendar-Tool-Call). Die endgueltige Roundtrip-
  // Ersparnis im Buchungs-Normalfall ist die erwartete Modell-Konsequenz daraus.
  assert.equal(reqCount - before, 1, "es darf nur ein LLM-Roundtrip noetig sein");
  assert.ok(lastSystem[0].text.includes(EVENT_TITLE), "der gesendete System-Prompt fuehrt die Slots");
});

test("6 Disclosure byte-identisch: die Einbettung beruehrt den Offenlegungssatz nicht", () => {
  assert.equal(disclosureSentence(ownerCall({ language: "de" })), DISCLOSURE_DE);
});
