// PLAN-PERSONAL-ASSISTANT P1 (Kontext-Bruecke): die geschaerften place_call-
// Feldbeschreibungen sind reine MCP-Client-Metadaten (advisory, runtime-folgenlos).
// Dieser Test nagelt zwei Dinge fest: (1) die briefing-Beschreibung weist das
// aufrufende Chat-LLM aktiv an, den Chat-Kontext ZUSAMMENGEFASST, ohne Secrets und
// in der Assistenten-Rolle weiterzureichen; (2) das Schema deckt die erwartete Feld-
// Menge + Optionalitaet ab. P3 ergaenzt das OPTIONALE advisory-Feld context (Server
// bleibt autoritativ, Wirkung nur bei ASSISTANT_CONTEXT_ENABLED); die Required-Menge
// bleibt unveraendert -> /api/calls bei Flag aus byte-identisch (die P0-Pins in
// personal-assistant-characterization.test.js decken das Laufzeitverhalten ab). P2b
// ergaenzt zusaetzlich das OPTIONALE Diagnose-Retention-Flag diagnostic (Server bleibt
// autoritativ, siehe src/diagnostic-retention.js); auch das aendert die Required-Menge nicht.
//
// Seam wie mcp-tools.test.js / mcp-ui.test.js: ein fakeServer faengt die per
// server.tool ODER server.registerTool registrierten Schemas ein, ohne echten
// MCP-Transport. place_call laeuft seit W2 ueber registerTool (uiTool) statt
// server.tool (Bestands-API) - deshalb faengt dieser Helper BEIDE Registrierungswege
// in dieselbe Map (schema = die reine Zod-Feldmenge, bei registerTool aus
// config.inputSchema). registerResource ist ein No-Op (die UI-Tools brauchen wir
// hier nicht).
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerTools } from "../src/mcp-tools.js";

function captureSchemas() {
  const schemas = new Map();
  const fakeServer = {
    tool(name, _desc, schema, _handler) {
      schemas.set(name, schema);
    },
    registerTool(name, config, _handler) {
      schemas.set(name, config.inputSchema);
    },
    registerResource() {},
  };
  registerTools(fakeServer, {});
  return schemas;
}

// Soll-Form von place_call NACH P2b (= P1 + das optionale advisory-Feld context + das
// optionale Diagnose-Retention-Flag diagnostic). Aus diesen Eintraegen leiten sich
// Feldanzahl + Optionalitaet ab - kein nacktes Zahl-Literal (G25).
const PLACE_CALL_SHAPE = {
  to: { optional: false },
  objective: { optional: false },
  briefing: { optional: true },
  constraints: { optional: true },
  context: { optional: true },
  language: { optional: true },
  max_duration_s: { optional: true },
  diagnostic: { optional: true },
};

test("P1-01: place_call-briefing-Beschreibung verlangt zusammengefassten Kontext ohne Secrets in der Assistenten-Rolle", () => {
  const schema = captureSchemas().get("place_call");
  assert.ok(schema, "place_call ist registriert");
  const briefing = schema.briefing.description || "";
  assert.match(briefing, /kontext/i, "nennt 'Kontext'");
  assert.match(briefing, /zusammenfass/i, "verlangt Zusammenfassen statt Roh-Dump");
  assert.match(briefing, /secret/i, "untersagt Secrets");
  assert.match(briefing, /assistent/i, "haelt die Assistenten-Rolle (kein Claude/Gemini)");
});

test("P1-02 (nach P2b): place_call-Schema bleibt strukturell unveraendert (gleiche Felder + Optionalitaet)", () => {
  const schema = captureSchemas().get("place_call");
  const actualKeys = Object.keys(schema).sort();
  const expectedKeys = Object.keys(PLACE_CALL_SHAPE).sort();
  assert.deepEqual(actualKeys, expectedKeys, "keine neuen/entfernten Felder");
  for (const [field, { optional }] of Object.entries(PLACE_CALL_SHAPE)) {
    assert.equal(
      schema[field].isOptional(),
      optional,
      `Optionalitaet von '${field}' unveraendert`,
    );
  }
});

// I9 (call-quality Impl-1) + Runde 2 (S-B): die objective-Beschreibung macht dem
// aufrufenden Chat-LLM vier Dinge klar - (1) der Satz wird nach der Offenlegung
// WOERTLICH vorgesprochen, bevor der Angerufene antwortet; (2) er ist ein sprechbarer
// Ich-Satz, KEIN Infinitiv-Stummel; (3) IMMER konkretes Thema/Anlass nennen, wenn
// bekannt; (4) bei unbekanntem Thema erst kurz beim Nutzer nachfragen statt vage
// anzurufen. Regex-Pins statt Woertlich-Pin (wie P1-01: advisory-Metadaten).
test("I9-01: place_call-objective-Beschreibung verlangt Ich-Satz + konkretes Thema + warnt vor woertlichem Vorsprechen", () => {
  const schema = captureSchemas().get("place_call");
  const objective = schema.objective.description || "";
  assert.match(objective, /woertlich vorgesprochen/i, "nennt das woertliche Vorsprechen");
  assert.match(objective, /ich-satz/i, "verlangt einen sprechbaren Ich-Satz");
  assert.match(objective, /kein infinitiv-stummel/i, "untersagt Infinitiv-Stummel");
  assert.match(objective, /offenlegung/i, "verortet es nach der Offenlegung");
  assert.match(objective, /konkretes thema/i, "verlangt konkretes Thema/Anlass");
  assert.match(objective, /frage zuerst kurz beim nutzer nach/i, "verlangt Rueckfrage statt vagem Auftrag");
});

// P3 (PLAN-PERSONAL-ASSISTANT): das context-Feld ist OPTIONAL (advisory) und seine
// Beschreibung haelt den Anti-Spoofing-/Secret-Vertrag - genau wie briefing in P1-01.
// Das Schema wird immer annonciert; der Server (Flag) entscheidet ueber die Wirkung.
test("P3-01: place_call-context ist optional + Beschreibung haelt Hintergrund-/Secret-/Assistenten-Vertrag", () => {
  const schema = captureSchemas().get("place_call");
  assert.ok(schema.context, "context ist registriert");
  assert.equal(schema.context.isOptional(), true, "context ist optional (advisory)");
  const desc = schema.context.description || "";
  assert.match(desc, /hintergrund/i, "nennt 'Hintergrund'");
  assert.match(desc, /secret/i, "untersagt Secrets");
  assert.match(desc, /assistent/i, "haelt die Assistenten-Rolle (kein Claude/Gemini)");
});
