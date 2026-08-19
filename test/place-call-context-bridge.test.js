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
// P15/O14: die Beschreibungen sind seit dem Sprachreinheits-Rest EINSPRACHIG ENGLISCH
// (Modellsprache != Nutzersprache, s. Kopf von src/mcp-tools.js). Die AUSSAGE dieser Tests
// ist unveraendert - nur die Regex-Anker greifen jetzt den englischen Wortlaut. Die
// Vollstaendigkeit der Emphase-Marker haelt zusaetzlich
// test/p15-mcp-tool-descriptions-en.test.js.
//
// Seam wie mcp-tools.test.js / mcp-ui.test.js: ein fakeServer faengt die per
// server.tool ODER server.registerTool registrierten Schemas ein, ohne echten
// MCP-Transport. place_call laeuft seit W2 ueber registerTool (uiTool) statt
// server.tool (Bestands-API) - deshalb faengt dieser Helper BEIDE Registrierungswege
// in dieselbe Map (schema = die reine Zod-Feldmenge, bei registerTool aus
// config.inputSchema). registerResource ist ein No-Op (die UI-Tools brauchen wir
// hier nicht).
// AL-P9 (unten): zwei Faelle brauchen mehr als die Schema-Form - z, um die Feldmenge so
// zu parsen, wie das MCP-SDK sie parst (z.object(shape), strip-Modus), und den
// Spawn-Server, um denselben Aufruf ueber die ECHTE /mcp-Route bis in den Store zu
// verfolgen. Kein echter Anruf: FAKE_ORIGINATE haelt den Anrufstart netzfrei.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registerTools } from "../src/mcp-tools.js";
import { mcpPost, startServer, toolCall } from "./helpers.js";

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

// Soll-Form von place_call NACH P10/LANG-15 (= P1 + das optionale advisory-Feld context +
// das optionale Diagnose-Retention-Flag diagnostic, MINUS das wirkungslose language-Feld,
// das P10 entfernt hat - die Sprache loest der Server ausschliesslich ueber
// store.resolveCallLanguage auf, s. Nachtrag 2026-07-28 in tasks/gates-fix-chain.md).
// Aus diesen Eintraegen leiten sich Feldanzahl + Optionalitaet ab - kein nacktes
// Zahl-Literal (G25).
const PLACE_CALL_SHAPE = {
  to: { optional: false },
  objective: { optional: false },
  briefing: { optional: true },
  constraints: { optional: true },
  mandate: { optional: true },
  context: { optional: true },
  max_duration_s: { optional: true },
  diagnostic: { optional: true },
};

test("P1-01: place_call-briefing-Beschreibung verlangt zusammengefassten Kontext ohne Secrets in der Assistenten-Rolle", () => {
  const schema = captureSchemas().get("place_call");
  assert.ok(schema, "place_call ist registriert");
  const briefing = schema.briefing.description || "";
  assert.match(briefing, /context/i, "nennt 'Kontext'");
  assert.match(briefing, /summari/i, "verlangt Zusammenfassen statt Roh-Dump");
  assert.match(briefing, /secret/i, "untersagt Secrets");
  assert.match(briefing, /assistant/i, "haelt die Assistenten-Rolle (kein Claude/Gemini)");
});

test("P1-02 (nach P10/LANG-15): place_call-Schema bleibt strukturell unveraendert (gleiche Felder + Optionalitaet)", () => {
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
  assert.match(objective, /read out VERBATIM/i, "nennt das woertliche Vorsprechen");
  assert.match(objective, /first-person/i, "verlangt einen sprechbaren Ich-Satz");
  assert.match(objective, /no bare-infinitive stub/i, "untersagt Infinitiv-Stummel");
  assert.match(objective, /disclosure/i, "verortet es nach der Offenlegung");
  assert.match(objective, /concrete topic/i, "verlangt konkretes Thema/Anlass");
  assert.match(objective, /ask the user FIRST/i, "verlangt Rueckfrage statt vagem Auftrag");
});

// P3 (PLAN-PERSONAL-ASSISTANT): das context-Feld ist OPTIONAL (advisory) und seine
// Beschreibung haelt den Anti-Spoofing-/Secret-Vertrag - genau wie briefing in P1-01.
// Das Schema wird immer annonciert; der Server (Flag) entscheidet ueber die Wirkung.
test("P3-01: place_call-context ist optional + Beschreibung haelt Hintergrund-/Secret-/Assistenten-Vertrag", () => {
  const schema = captureSchemas().get("place_call");
  assert.ok(schema.context, "context ist registriert");
  assert.equal(schema.context.isOptional(), true, "context ist optional (advisory)");
  const desc = schema.context.description || "";
  assert.match(desc, /background/i, "nennt 'Hintergrund'");
  assert.match(desc, /secret/i, "untersagt Secrets");
  assert.match(desc, /assistant/i, "haelt die Assistenten-Rolle (kein Claude/Gemini)");
});

// P6 (PLAN-CONVERSATION-QUALITY-V2): das mandate-Feld ist OPTIONAL (advisory Schema, der
// Server validiert/normalisiert autoritativ). Die Beschreibungen SIND das Feature: sie
// zwingen das aufrufende Chat-Modell, den Owner nach dem Rahmen zu fragen, statt einen zu
// erfinden, und stellen den E1-Vertrag (kein Buchen/Kalender) sowie den
// constraints-Vorrang klar.
test("P6-01: place_call-mandate ist optional + Beschreibungen halten E1-/Vorrang-/Enum-Vertrag", () => {
  const schema = captureSchemas().get("place_call");
  assert.ok(schema.mandate, "mandate ist registriert");
  assert.equal(schema.mandate.isOptional(), true, "mandate ist optional (advisory)");
  const desc = schema.mandate.description || "";
  assert.match(desc, /mandate/i, "nennt 'Mandat'");
  assert.match(
    desc,
    /books NOTHING|NO calendar access/i,
    "haelt den E1-Vertrag (kein Buchen/Kalenderzugriff)",
  );
  assert.match(desc, /constraints ALWAYS win/i, "nennt den constraints-Vorrang");
  const inner = schema.mandate.unwrap();
  const decideFreely = inner.shape.decide_freely.description || "";
  assert.match(decideFreely, /concretely/i, "decide_freely verlangt Konkretheit");
  assert.match(decideFreely, /constraints/i, "decide_freely verweist auf constraints");
  const onOutOfScope = inner.shape.on_out_of_scope.description || "";
  assert.match(onOutOfScope, /take_message/, "on_out_of_scope dokumentiert take_message");
  assert.match(onOutOfScope, /decline/, "on_out_of_scope dokumentiert decline");
  assert.match(onOutOfScope, /accept_best/, "on_out_of_scope dokumentiert accept_best");
});

// ---- AL-P9 (offene Fragen): das Feld, das place_call still verwirft -------------------
// ABSICHTLICH ROT. context.open_questions ist die Eingabe des Eroeffnungs-Consults
// (AL-P13, "Consult #0"): die Fragen, die der Auftrag offen laesst, werden beantwortet,
// WAEHREND das Telefon klingelt - 0 ms Gespraechslatenz. Der Server ist dafuer
// vollstaendig gebaut: _validation.js fuehrt open_questions unter CONTEXT_FIELDS und
// validiert es (max. 10 Eintraege a 300 Zeichen), routes/api-calls.js liest es in
// emitOpeningConsult und emittiert daraus den Consult.
//
// Ueber place_call kann dieser Weg trotzdem NIE feuern: das zod-Objekt des context-Feldes
// (src/mcp-tools.js) deklariert vier Teilfelder - summary, key_facts,
// recipient_relationship, desired_outcome - und open_questions ist keins davon. zod
// strippt unbekannte Keys still (dieselbe Falle, die die Kommentare an mandate und
// diagnostic bereits benennen: "Ohne Eintrag im zod-Schema erreichte das Feld /api/calls
// nie"). Es gibt keinen Fehler, keine Warnung und keinen Log-Eintrag - der Anruf laeuft,
// nur ohne die Antworten, die ihn haetten tragen sollen.
//
// GEPINNT wird der SOLL-Zustand (die Fragen kommen an), nicht das heutige Strippen: ein
// Test, der das Verschwinden festschreibt, macht den Defekt zur Zusage. Zwei Ebenen, weil
// nur beide zusammen den Weg belegen - die Schema-Pruefung ist der Ort des Verlusts, der
// Call-Datensatz der Ort, an dem der Wert gebraucht wird.
//
// Die Schema-Pruefung wird hier so gefahren, wie das MCP-SDK sie fahrt: die registrierte
// Feldmenge ist eine rohe zod-Shape, das SDK macht daraus z.object(shape) und uebergibt
// dem Handler das ERGEBNIS dieses Parse. z.object(...) ohne .passthrough() ist im
// strip-Modus - genau das ist der Verlust.
const PLACE_CALL_INPUT = Object.freeze({
  to: "+4915112345678",
  objective: "I would like to book a men's haircut for Max on Saturday morning.",
});
const OFFENE_FRAGEN = Object.freeze(["Welche Uhrzeit passt genau?", "Darf es auch Freitag sein?"]);
// Ein Geschwisterfeld, das heute nachweislich durchkommt: ohne diese Positiv-Kontrolle
// saehe "open_questions fehlt" genauso aus wie "das ganze context-Objekt faellt weg"
// (Lehre pruefkommando-ohne-positiv-kontrolle).
const KEY_FACTS = Object.freeze(["Stammkunde seit drei Jahren"]);
const CONTEXT_MIT_FRAGEN = Object.freeze({ key_facts: KEY_FACTS, open_questions: OFFENE_FRAGEN });

test("AL-P9-10: ueber das place_call-Schema uebergebene open_questions ueberleben die Schema-Pruefung", () => {
  const schema = captureSchemas().get("place_call");
  const geparst = z.object(schema).parse({ ...PLACE_CALL_INPUT, context: CONTEXT_MIT_FRAGEN });

  assert.deepEqual(
    geparst.context?.key_facts,
    KEY_FACTS,
    "Positiv-Kontrolle: ein deklariertes Geschwisterfeld ueberlebt denselben Parse - faellt schon das aus, misst der Fall unten nicht das Strippen",
  );
  assert.deepEqual(
    geparst.context?.open_questions,
    OFFENE_FRAGEN,
    "open_questions ist im context-Objekt von place_call nicht deklariert und wird von zod still gestrippt - der Eroeffnungs-Consult (AL-P13) kann ueber place_call deshalb NIE feuern, obwohl Validierung (routes/_validation.js) und Auswertung (routes/api-calls.js emitOpeningConsult) dafuer gebaut sind",
  );
});

// Die zweite Ebene: derselbe Aufruf ueber die ECHTE MCP-Route bis in den Store. Ein
// Schema-Fall allein bewiese nur, dass zod das Feld durchlaesst - nicht, dass es dort
// ankommt, wo emitOpeningConsult es liest. Spawn-Muster wie test/assistant-context-http.js
// (Owner-Pfad, ASSISTANT_CONTEXT_ENABLED an - ohne das Kanal-Gate setzt der
// assistant_context-Gate ctx.context auf null und der Fall maesse eine Luecke, die er
// selbst erzeugt hat). FAKE_ORIGINATE haelt den Anrufstart netzfrei: kein echter Anruf,
// keine Anbieter-API.
const CALL_ZIEL = "+4915112345678";
// Benannt statt nackt (Repo-Regel: keine Magic Numbers) - die eine Achse, an der dieser
// Fall scheitern koennte, ohne den Kontext-Weg ueberhaupt erreicht zu haben.
const HTTP_UNAUTHORIZED = 401;
const E2E_ENV = Object.freeze({
  ASSISTANT_CONTEXT_ENABLED: "true",
  FAKE_ORIGINATE: "true",
  ALLOWED_COUNTRY_CODES: "*",
});

test("AL-P9-11: ueber die MCP-Route uebergebene open_questions stehen am Call-Datensatz", async () => {
  const srv = await startServer({ env: E2E_ENV });
  try {
    const res = await mcpPost(
      `${srv.localUrl}/mcp`,
      null,
      toolCall("place_call", {
        ...PLACE_CALL_INPUT,
        to: CALL_ZIEL,
        context: CONTEXT_MIT_FRAGEN,
      }),
    );
    assert.notEqual(res.status, HTTP_UNAUTHORIZED, "Vorbedingung: die MCP-Route nimmt den Aufruf an");
    // Der Rumpf MUSS vor dem Store-Lesen abgeholt werden: der Streamable-HTTP-Transport
    // antwortet als SSE, fetch loest schon mit den Kopfzeilen auf - der Handler laeuft zu
    // diesem Zeitpunkt noch. Ohne diese Zeile liest der Store einen Stand VOR dem Anruf.
    const antwort = await res.text();

    const call = srv.readStore().calls.find((eintrag) => eintrag.to === CALL_ZIEL);
    assert.ok(call, `Vorbedingung: kein Call-Datensatz angelegt - Antwort: ${antwort}`);
    assert.deepEqual(
      call.context?.key_facts,
      KEY_FACTS,
      "Positiv-Kontrolle: ein deklariertes Geschwisterfeld erreicht den Record ueber genau diesen Weg",
    );
    assert.deepEqual(
      call.context?.open_questions,
      OFFENE_FRAGEN,
      "die offenen Fragen erreichen den Call-Datensatz nicht - emitOpeningConsult liest ein leeres Feld und legt keinen Consult an, der Anruf laeuft ohne die Antworten, die er gebraucht haette",
    );
  } finally {
    await srv.stop();
  }
});
