import { test } from "node:test";
import assert from "node:assert/strict";
import { registerTools } from "../src/mcp-tools.js";
import { SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";
import { GERMAN_STOPWORDS } from "./helpers.js";

const NON_EMPHASIS_TOKENS = new Set(["AI", "KYC", "XX", "JSON", "ID"]);
const CAPS_TOKEN = /\b[A-Z]{2,}\b/g;

function capsMarkersOf(text) {
  return (text.match(CAPS_TOKEN) || []).filter((t) => !NON_EMPHASIS_TOKENS.has(t));
}

function captureDescriptions(ctx = {}) {
  const descriptions = new Map();
  const collect = (name, description, schema) => {
    descriptions.set(name, description || "");
    for (const [field, node] of Object.entries(schema || {})) {
      descriptions.set(`${name}.${field}`, node?.description || "");
      const inner = typeof node?.unwrap === "function" ? node.unwrap() : null;
      if (!inner?.shape) continue;
      for (const [sub, subNode] of Object.entries(inner.shape))
        descriptions.set(`${name}.${field}.${sub}`, subNode?.description || "");
    }
  };
  const fakeServer = {
    tool: (name, description, schema) => collect(name, description, schema),
    registerTool: (name, config) => collect(name, config.description, config.inputSchema),
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return descriptions;
}

const EXPECTED_MARKERS = {
  place_call: ["REQUIRES", "FIRST", "NOT", "NOT", "NOT", "ALWAYS"],
  "place_call.to": ["EXACTLY", "NEVER"],
  "place_call.objective": ["ONE", "VERBATIM", "BEFORE", "NO", "ALWAYS", "FIRST", "NOT"],
  "place_call.briefing": ["SUMMARISE", "NO", "KNOW"],
  "place_call.constraints": [],
  "place_call.mandate": ["MANDATE", "ITSELF", "NOTHING", "NO", "ALWAYS"],
  "place_call.mandate.decide_freely": ["WITHOUT", "WITHOUT", "NOT"],
  "place_call.mandate.fallback_order": [],
  "place_call.mandate.on_out_of_scope": ["OUTSIDE", "ONLY"],
  "place_call.context": ["BACKGROUND", "NEVER", "NO"],
  "place_call.context.summary": [],
  "place_call.context.key_facts": ["NO"],
  "place_call.context.recipient_relationship": [],
  "place_call.context.desired_outcome": [],
  "place_call.context.open_questions": ["BEFORE"],
  "place_call.max_duration_s": ["SHORTER"],
  "place_call.language": ["SPEAKS", "REJECTED", "NOT"],
  "place_call.diagnostic": ["OWN", "NOT", "ONLY"],
  get_call_status: [],
  "get_call_status.call_id": [],
  get_call_result: ["NEVER"],
  "get_call_result.call_id": [],
  cancel_call: ["NOT"],
  "cancel_call.call_id": [],
  get_agent_number: [],
  list_calls: [],
  check_inbox: ["CONSUMING", "NOT", "NOT"],
  "check_inbox.include_seen": ["NO"],
  list_action_items: [],
  get_agent_status: [],
  "place_call.confirmation_code": ["SAME", "REQUIRED", "NOT"],
  prepare_call: ["WITHOUT", "EVERY"],
  "prepare_call.to": ["EXACTLY", "NEVER"],
  "prepare_call.objective": ["ONE", "VERBATIM", "BEFORE", "NO", "ALWAYS", "FIRST", "NOT"],
  "prepare_call.briefing": ["SUMMARISE", "NO", "KNOW"],
  "prepare_call.constraints": [],
  "prepare_call.mandate": ["MANDATE", "ITSELF", "NOTHING", "NO", "ALWAYS"],
  "prepare_call.mandate.decide_freely": ["WITHOUT", "WITHOUT", "NOT"],
  "prepare_call.mandate.fallback_order": [],
  "prepare_call.mandate.on_out_of_scope": ["OUTSIDE", "ONLY"],
  "prepare_call.context": ["BACKGROUND", "NEVER", "NO"],
  "prepare_call.context.summary": [],
  "prepare_call.context.key_facts": ["NO"],
  "prepare_call.context.recipient_relationship": [],
  "prepare_call.context.desired_outcome": [],
  "prepare_call.context.open_questions": ["BEFORE"],
  "prepare_call.language": ["SPEAKS", "REJECTED", "NOT"],
  "prepare_call.max_duration_s": ["SHORTER"],
  "prepare_call.diagnostic": ["OWN", "NOT", "ONLY"],
};

test("O14: keine der MCP-Tool-/Feld-Beschreibungen enthaelt noch deutschen Text", () => {
  const descriptions = captureDescriptions();
  assert.ok(descriptions.size > 0, "es wurden ueberhaupt Beschreibungen eingesammelt");
  for (const [pathName, description] of descriptions)
    assert.doesNotMatch(description, GERMAN_STOPWORDS, `${pathName} ist englisch`);
});

test("O14: die Stopwortliste ist byte-gepinnt (Aufweichen ist verboten)", () => {
  assert.equal(
    GERMAN_STOPWORDS.source,
    "Guten Tag|Hallo|kann gerade nicht|Anruf|Gegenseite|Bitte spaeter erneut|Nachricht|Ungueltige|Anmeldung fehlgeschlagen|Sitzung abgelaufen|Grund|Besitzer|Auftrag",
  );
});

test("O14: die Emphase-Marker sind je Beschreibung nach Anzahl UND Reihenfolge erhalten", () => {
  const descriptions = captureDescriptions();
  assert.deepEqual(
    [...descriptions.keys()].sort(),
    Object.keys(EXPECTED_MARKERS).sort(),
    "die Menge der Beschreibungs-Pfade ist unveraendert",
  );
  for (const [pathName, expected] of Object.entries(EXPECTED_MARKERS))
    assert.deepEqual(capsMarkersOf(descriptions.get(pathName)), expected, pathName);
});

test("O14: die Negativ-Beispiele der Qualitaets-Kette stehen woertlich in der EN-Fassung", () => {
  const descriptions = captureDescriptions();
  const objective = descriptions.get("place_call.objective");
  assert.match(objective, /NO bare-infinitive stub like 'Book an appointment'/);
  assert.match(objective, /read out VERBATIM/);
  assert.match(objective, /ask the user FIRST/);
  const decideFreely = descriptions.get("place_call.mandate.decide_freely");
  assert.match(decideFreely, /Hard prohibitions do NOT belong here/);
});

test("LANG-15 (SOLL, gruen nach F-2) - place_call.language nennt den Katalog, lehnt unbekannte Codes ab und bleibt von der Offenlegung getrennt", () => {
  const text = captureDescriptions().get("place_call.language");
  assert.ok(text, "der Pfad existiert");
  for (const code of SUPPORTED_LANGUAGES) assert.ok(text.includes(code), `Katalog nennt ${code}`);
  assert.match(text, /REJECTED/);
  assert.match(text, /disclosure/i);
});

const EXPECTED_CONSULT_MARKERS = {
  await_call_event: ["REPEATEDLY", "NEVER"],
  "await_call_event.call_id": [],
  "await_call_event.after_event_id": [],
  answer_consult: ["FIRST", "THEN", "SHORT", "REJECTED", "NOT"],
  "answer_consult.call_id": [],
  "answer_consult.event_id": [],
  "answer_consult.status": [],
  "answer_consult.answers": [],
};

test("O14/AL-P13: die Consult-Werkzeuge erscheinen nur mit Faehigkeit - und sind englisch", () => {
  const withConsult = captureDescriptions({ consultAllowed: true });
  for (const pathName of Object.keys(EXPECTED_CONSULT_MARKERS)) {
    assert.ok(!captureDescriptions().has(pathName), `${pathName} fehlt ohne Faehigkeit`);
    assert.ok(withConsult.has(pathName), `${pathName} erscheint mit Faehigkeit`);
    assert.doesNotMatch(withConsult.get(pathName), GERMAN_STOPWORDS, `${pathName} ist englisch`);
  }
});

test("O14/AL-P13: die Emphase der Consult-Werkzeuge ist nach Anzahl UND Reihenfolge gepinnt", () => {
  const withConsult = captureDescriptions({ consultAllowed: true });
  for (const [pathName, expected] of Object.entries(EXPECTED_CONSULT_MARKERS))
    assert.deepEqual(capsMarkersOf(withConsult.get(pathName)), expected, pathName);
  assert.deepEqual(capsMarkersOf(withConsult.get("place_call")), EXPECTED_MARKERS.place_call);
  assert.ok(withConsult.get("place_call").startsWith(captureDescriptions().get("place_call")));
});
