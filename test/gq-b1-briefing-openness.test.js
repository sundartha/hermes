// GQ-B1 - Waechter ueber die drei Aussagen, die diese Phase in die
// place_call-Beschreibungen gelegt hat: (1) das Briefing darf keine Wissensluecke
// vorweg beantworten und keine Vertroestung auf den Auftraggeber schreiben,
// (2) der Hinweis auf die Live-Rueckfrage haengt am AKTIVEN Kanal und ist
// konditional formuliert, (3) die Vorab-Rueckfrage im Chat steht nur noch an
// EINER Stelle. Dazu zwei Zeichen-Deckel und der Draht zwischen der Zahl im
// Loop-Text und der Zahl im Code.
//
// KEIN Server-Spawn: alles laeuft gegen einen Attrappen-Server, der beide
// Registrierungswege einsammelt (server.tool positionsbasiert, server.registerTool
// per config). DATA_DIR wird VOR den dynamischen Imports auf ein Temp-Verzeichnis
// gebunden, weil GQ-B1-06 MAX_IN_CALL_CONSULTS_PER_CALL aus src/consult/in-call.js
// liest und dieses Modul die Store-Fassade zieht - json.js bindet seinen Dateipfad
// beim Import (Muster wie test/al-p14-in-call-consult.test.js).
//
// Eigener Attrappen-Bauer statt Wiederverwendung des Bauers aus
// test/p15-mcp-tool-descriptions-en.test.js: eine gemeinsame Naht muesste dessen
// collect-Pfeil verschieben, und der traegt heute einen eingefrorenen
// complexity-Befund (eslint-suppressions.json). Ihn zu verschieben braeche die
// Aufraeum-Ratsche des pre-commit-Hooks und zoege eine fremde Lint-Sanierung in
// eine reine Text-Phase. Die Zerlegung hier ist deshalb flacher (describedOf /
// objectShapeOf), nicht kopiert - und lint-sauber ohne Ausnahme.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState } from "./helpers.js";

let registerTools;
let maxInCallConsultsPerCall;
let consultInstructions;

before(async () => {
  process.env.DATA_DIR = tempDataDir(seedState({}));
  ({ registerTools } = await import("../src/mcp-tools.js"));
  ({ MCP_CONSULT_INSTRUCTIONS: consultInstructions } = await import("../src/mcp-server-info.js"));
  ({ MAX_IN_CALL_CONSULTS_PER_CALL: maxInCallConsultsPerCall } = await import(
    "../src/consult/in-call.js"
  ));
});

// Jede Beschreibung kostet bei JEDEM Turn des Client-Modells Token. Der Deckel ist
// kein Stil-Test: er zwingt die naechste Phase, Zuwachs zu begruenden statt
// anzuhaengen. Anheben nur mit benanntem Grund. Die Luft ist bewusst knapp bemessen,
// aber nicht so knapp, dass eine Wortwahl-Korrektur ihn reisst (gemessen: 5667 von
// 5800 ohne Kanal, 6069 von 6200 mit Kanal).
const PLACE_CALL_BUDGET_CHARS = 5800;
const PLACE_CALL_WITH_CONSULT_BUDGET_CHARS = 6200;
const CONSULT_CTX = Object.freeze({ consultAllowed: true });
const PLACE_CALL_PREFIX = "place_call";
// GROSS-/KLEINSCHREIBUNG BEWUSST EGAL: der Bestand trug den Satz einmal als "ask the
// user FIRST" (objective) und einmal als "Ask the user FIRST" (mandate.decide_freely).
// Ein schreibungsgenauer Zaehler haette schon VOR dieser Phase genau einen Treffer
// gefunden und damit nichts belegt (Lehre bench-must-reproduce-defect).
const ASK_FIRST = /ask the user first/gi;

const describedOf = (node) => node?.description || "";

// Optionale Objekt-Felder (mandate/context) tragen ihre Unterfelder erst nach unwrap();
// skalare Optionals liefern kein shape.
const objectShapeOf = (node) => {
  const inner = typeof node?.unwrap === "function" ? node.unwrap() : null;
  return inner?.shape || null;
};

// Alle Beschreibungen als Pfad -> Text: "<tool>", "<tool>.<feld>", "<tool>.<feld>.<unterfeld>".
function captureDescriptions(ctx = {}) {
  const descriptions = new Map();
  const collect = (name, description, schema) => {
    descriptions.set(name, description || "");
    for (const [field, node] of Object.entries(schema || {})) {
      descriptions.set(`${name}.${field}`, describedOf(node));
      const shape = objectShapeOf(node);
      if (!shape) continue;
      for (const [sub, subNode] of Object.entries(shape))
        descriptions.set(`${name}.${field}.${sub}`, describedOf(subNode));
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

const placeCallPaths = (descriptions) =>
  [...descriptions].filter(([pfad]) => pfad.startsWith(PLACE_CALL_PREFIX));

const placeCallChars = (descriptions) =>
  placeCallPaths(descriptions).reduce((summe, [, text]) => summe + text.length, 0);

// Der ANGEHAENGTE Teil des Tool-Deskriptors. Nutzt dieselbe Invariante, die AL-P13-36
// bereits haelt (der Bestandstext bleibt byte-identischer Prefix) - so braucht der Fall
// keinen neuen Export von PLACE_CALL_CONSULT_LOOP.
const loopSuffixOf = (plain, withConsult) => withConsult.slice(plain.length);

test("GQ-B1-01: die briefing-Beschreibung verbietet die Vertroestung und verlangt die offene Luecke", () => {
  const briefing = captureDescriptions().get("place_call.briefing");
  assert.match(briefing, /never script an answer/i, "untersagt die vorweggenommene Antwort");
  assert.match(briefing, /get back to the other party/i, "untersagt die Vertroestung");
  assert.match(briefing, /Leave the gap open/i, "verlangt die offene Luecke");
  // Das Feld ist IMMER registriert - es darf kein Werkzeug versprechen, das bei
  // ausgeschaltetem Kanal gar nicht existiert.
  assert.doesNotMatch(briefing, /await_call_event/, "nennt kein kanalabhaengiges Werkzeug");
  assert.doesNotMatch(briefing, /get_consult/, "nennt kein kanalabhaengiges Werkzeug");
});

test("GQ-B1-02: der Hinweis auf die Live-Rueckfrage steht NUR bei aktivem Kanal", () => {
  const plain = captureDescriptions().get(PLACE_CALL_PREFIX);
  const looped = captureDescriptions(CONSULT_CTX).get(PLACE_CALL_PREFIX);
  assert.doesNotMatch(plain, /inside this loop/i, "ohne Kanal kein Schleifen-Hinweis");
  assert.match(looped, /its question reaches you only inside this loop/i, "konditional formuliert");
  assert.match(looped, /at most once/i, "nennt das Kontingent");
  // B-O2: die Gratis-Rueckfrage waehrend der Klingelzeit ist auf dem live laufenden Weg
  // nicht gedeckt - die Zusage darf nicht zurueckwandern.
  assert.doesNotMatch(looped, /while the phone is still ringing/i, "keine Klingelzeit-Zusage");
});

test("GQ-B1-03: die Vorab-Rueckfrage steht an GENAU EINER Stelle des place_call-Schemas", () => {
  // Capture MIT Kanal, damit der angehaengte Loop-Text mit im Sichtfeld liegt - sonst
  // koennte die Vorab-Rueckfrage genau dort ungesehen wieder einwandern.
  const treffer = placeCallPaths(captureDescriptions(CONSULT_CTX)).flatMap(([pfad, text]) =>
    (text.match(ASK_FIRST) || []).map(() => pfad),
  );
  // answer_consult traegt denselben Wortlaut bewusst weiter - anderer Pfad, anderer
  // Zeitpunkt (IM Gespraech, dort ist die Rueckfrage richtig). Die Praefix-Einschraenkung
  // auf place_call* ist Absicht.
  assert.deepEqual(treffer, ["place_call.objective"], "Anzahl UND Ort sind gepinnt");
});

test("GQ-B1-04: die place_call-Beschreibungen bleiben unter dem Zeichen-Deckel", () => {
  const ohneKanal = placeCallChars(captureDescriptions());
  assert.ok(
    ohneKanal <= PLACE_CALL_BUDGET_CHARS,
    `place_call-Beschreibungen ohne Kanal: ${ohneKanal} von ${PLACE_CALL_BUDGET_CHARS} Zeichen`,
  );
  const mitKanal = placeCallChars(captureDescriptions(CONSULT_CTX));
  assert.ok(
    mitKanal <= PLACE_CALL_WITH_CONSULT_BUDGET_CHARS,
    `place_call-Beschreibungen mit Kanal: ${mitKanal} von ${PLACE_CALL_WITH_CONSULT_BUDGET_CHARS} Zeichen`,
  );
});

test("GQ-B1-05: die Server-Instructions nennen die Frist, ohne eine Sekundenzahl zu nennen", () => {
  assert.ok(
    consultInstructions.startsWith("While a call placed with place_call is running"),
    "der Bestandstext bleibt byte-identischer Prefix",
  );
  assert.match(consultInstructions, /Staying in that loop pays off/, "Bestandssatz erhalten");
  assert.match(consultInstructions, /answer within seconds/i, "nennt die Dringlichkeit");
  // CONSULT_OPEN_MS liegt in der Konfiguration - eine Zahl im Text wuerde veralten.
  assert.doesNotMatch(consultInstructions, /\d+\s*(s|sec|seconds)\b/i, "keine Sekundenzahl");
});

test("GQ-B1-06: die Zahl im Loop-Text stammt aus der Zahl im Code", () => {
  // Wird der Kosten-Riegel je auf 2 gehoben, ist "at most once" im Loop-Text eine
  // Falschaussage - dieser Fall ist der Draht zwischen beiden.
  assert.equal(maxInCallConsultsPerCall, 1, "das Kontingent ist EINE Rueckfrage pro Anruf");
  const suffix = loopSuffixOf(
    captureDescriptions().get(PLACE_CALL_PREFIX),
    captureDescriptions(CONSULT_CTX).get(PLACE_CALL_PREFIX),
  );
  assert.match(suffix, /at most once/i, "der Loop-Text spiegelt genau dieses Kontingent");
});
