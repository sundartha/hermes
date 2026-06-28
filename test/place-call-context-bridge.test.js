// PLAN-PERSONAL-ASSISTANT P1 (Kontext-Bruecke): die geschaerften place_call-
// Feldbeschreibungen sind reine MCP-Client-Metadaten (advisory, runtime-folgenlos).
// Dieser Test nagelt zwei Dinge fest: (1) die briefing-Beschreibung weist das
// aufrufende Chat-LLM aktiv an, den Chat-Kontext ZUSAMMENGEFASST, ohne Secrets und
// in der Assistenten-Rolle weiterzureichen; (2) das Schema bleibt STRUKTURELL
// unveraendert (gleiche Felder + gleiche Optionalitaet) - kein neues Feld, keine
// geaenderte Required-Menge. /api/calls bleibt damit byte-identisch (die P0-Pins in
// personal-assistant-characterization.test.js decken das Laufzeitverhalten ab).
//
// Seam wie mcp-tools.test.js / mcp-ui.test.js: ein fakeServer faengt die per
// server.tool registrierten Schemas ein (Position 3), ohne echten MCP-Transport.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerTools } from "../src/mcp-tools.js";

// Faengt server.tool(name, desc, schema, handler) -> Map name -> schema. registerTool/
// registerResource sind No-Ops (die UI-Tools brauchen wir hier nicht).
function captureSchemas() {
  const schemas = new Map();
  const fakeServer = {
    tool(name, _desc, schema, _handler) {
      schemas.set(name, schema);
    },
    registerTool() {},
    registerResource() {},
  };
  registerTools(fakeServer, {});
  return schemas;
}

// Soll-Form von place_call NACH P1 (= unveraendert ggue. vorher). Aus diesen Eintraegen
// leiten sich Feldanzahl + Optionalitaet ab - kein nacktes Zahl-Literal (G25).
const PLACE_CALL_SHAPE = {
  to: { optional: false },
  objective: { optional: false },
  briefing: { optional: true },
  constraints: { optional: true },
  language: { optional: true },
  max_duration_s: { optional: true },
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

test("P1-02: place_call-Schema bleibt strukturell unveraendert (gleiche Felder + Optionalitaet)", () => {
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
