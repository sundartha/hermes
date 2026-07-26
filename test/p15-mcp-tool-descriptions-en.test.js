// P15/T3b - Waechter ueber die MCP-Tool-/Feld-Beschreibungen (Owner-Entscheidung O14).
//
// SYSTEMGRENZE: MODELLSPRACHE != NUTZERSPRACHE. Die Beschreibungen liest das Client-Modell
// (Claude in claude.ai), nicht der Tenant - sie sind EINSPRACHIG ENGLISCH und bekommen
// bewusst KEINE Sprachverzweigung. In ihnen stecken die in der Anrufqualitaets-Kette teuer
// erarbeiteten engen Verbote am Tool-Entscheidungspunkt; eine sinngemaesse Uebersetzung
// haette sie abgeschliffen. Dieser Test haelt drei Dinge fest:
//   (1) kein Deutsch mehr - gegen DIESELBE Stopwortliste wie das Sprachreinheits-Aggregat
//       (test/e2e-06-en-purity-aggregate.test.js). Das ersetzt exakt die Abdeckung, die die
//       R5-Korrektur dort abzieht (der Kanal mcpErrorLiterals misst seither nur noch
//       AUSGELIEFERTEN Text, nicht mehr die bewusst englischen Beschreibungen).
//   (2) die Stopwortliste selbst ist byte-gepinnt - eine spaetere Entschaerfung, die den
//       Aggregat-Test still gruen machen wuerde, schlaegt HIER rot.
//   (3) die Emphase ist erhalten: Anzahl UND Reihenfolge der Grossschreib-Marker je
//       Beschreibung sind gepinnt, dazu die vier riskantesten Negativ-Beispiele. Dieselbe
//       Mechanik, mit der P11 die Verbots-Emphase der gesprochenen Prompts gehalten hat.
//
// Harness wie test/place-call-context-bridge.test.js: ein fakeServer faengt BEIDE
// Registrierungswege (server.tool positionsbasiert, server.registerTool per config) ohne
// echten MCP-Transport ein.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { registerTools } from "../src/mcp-tools.js";
import { GERMAN_STOPWORDS, ROOT } from "./helpers.js";

// Grossschreib-Marker = Emphase. Ausgenommen sind dokumentierte ABKUERZUNGEN, die nur
// zufaellig gross sind und keine Betonung tragen (G25: benannte Menge statt Inline-Filter).
const NON_EMPHASIS_TOKENS = new Set(["AI", "KYC", "XX", "JSON", "ID"]);
const CAPS_TOKEN = /\b[A-Z]{2,}\b/g;

function capsMarkersOf(text) {
  return (text.match(CAPS_TOKEN) || []).filter((t) => !NON_EMPHASIS_TOKENS.has(t));
}

// Alle Beschreibungen als Pfad -> Text: "<tool>", "<tool>.<feld>", "<tool>.<feld>.<unterfeld>".
function captureDescriptions() {
  const descriptions = new Map();
  const collect = (name, description, schema) => {
    descriptions.set(name, description || "");
    for (const [field, node] of Object.entries(schema || {})) {
      descriptions.set(`${name}.${field}`, node?.description || "");
      // Optionale Objekt-Felder (mandate/context) tragen ihre Unterfelder erst nach
      // unwrap(); skalare Optionals liefern kein shape und werden uebersprungen.
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
  registerTools(fakeServer, {});
  return descriptions;
}

// Gepinnte Emphase-Inventur: Anzahl UND Reihenfolge je Beschreibungs-Pfad. Leere Listen sind
// bewusst mit aufgefuehrt - eine neu eingeschmuggelte Emphase faellt damit ebenso auf wie
// eine verlorene. Der Bestand vor P15 (deutsch) trug exakt dieselbe Marker-Zahl an
// denselben Satzpositionen (Marker-Inventur im Phasenplan).
const EXPECTED_MARKERS = {
  place_call: ["NOT"],
  "place_call.to": ["EXACTLY", "NEVER"],
  "place_call.objective": ["ONE", "VERBATIM", "BEFORE", "NO", "ALWAYS", "FIRST", "NOT"],
  "place_call.briefing": ["SUMMARISE", "NO"],
  "place_call.constraints": [],
  "place_call.mandate": ["MANDATE", "ITSELF", "NOTHING", "NO", "ALWAYS"],
  "place_call.mandate.decide_freely": ["WITHOUT", "FIRST", "WITHOUT", "NOT"],
  "place_call.mandate.fallback_order": [],
  "place_call.mandate.on_out_of_scope": ["OUTSIDE", "ONLY"],
  "place_call.context": ["BACKGROUND", "ADDITIONAL", "NEVER", "NO"],
  "place_call.context.summary": [],
  "place_call.context.key_facts": ["NO"],
  "place_call.context.recipient_relationship": [],
  "place_call.context.desired_outcome": [],
  "place_call.language": [],
  "place_call.max_duration_s": [],
  "place_call.diagnostic": ["ONLY", "OWN"],
  get_call_status: [],
  "get_call_status.call_id": [],
  get_transcript: ["NOT"],
  "get_transcript.call_id": [],
  cancel_call: [],
  "cancel_call.call_id": [],
  get_my_number: [],
  list_calls: [],
  list_action_items: [],
  get_calendar: [],
  get_agent_status: [],
};

test("O14: keine der MCP-Tool-/Feld-Beschreibungen enthaelt noch deutschen Text", () => {
  const descriptions = captureDescriptions();
  assert.ok(descriptions.size > 0, "es wurden ueberhaupt Beschreibungen eingesammelt");
  for (const [pathName, description] of descriptions)
    assert.doesNotMatch(description, GERMAN_STOPWORDS, `${pathName} ist englisch`);
});

// Pre-Mortem 2 (Spec Abschnitt 4): E2E-06 "gruen gemacht" durch Entschaerfen des Tests.
// Die Liste ist der Massstab beider Waechter - wer sie aufweicht, bricht hier byte-genau.
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

// Die vier Negativ-Beispiele, an denen die Anrufqualitaets-Kette die vagen Auftraege
// abgestellt hat. Sie muessen Beispiele BLEIBEN, nicht zu allgemeinen Hinweisen verwaschen.
test("O14: die Negativ-Beispiele der Qualitaets-Kette stehen woertlich in der EN-Fassung", () => {
  const descriptions = captureDescriptions();
  const objective = descriptions.get("place_call.objective");
  assert.match(objective, /NO bare-infinitive stub like 'Book an appointment'/);
  assert.match(objective, /read out VERBATIM/);
  assert.match(objective, /ask the user FIRST/);
  const decideFreely = descriptions.get("place_call.mandate.decide_freely");
  assert.match(decideFreely, /Hard prohibitions do NOT belong here/);
});

// Die Systemgrenze steht als Kommentar am Kopf von src/mcp-tools.js, damit die naechste
// Phase die Beschreibungen nicht versehentlich wieder in die Lokalisierung zieht.
test("O14: die Systemgrenze Modellsprache != Nutzersprache ist im Code dokumentiert", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/mcp-tools.js"), "utf8");
  assert.match(src, /MODELLSPRACHE != NUTZERSPRACHE/);
});
