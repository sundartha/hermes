// GQ-B1/GQ-B2 - Waechter ueber die Aussagen, die diese beiden Phasen in die
// place_call-Beschreibungen gelegt haben: (1) das Briefing darf keine Wissensluecke
// erfunden zuschreiben und sortiert jede Luecke nach der GQ-B2-Drei-Klassen-Regel
// (eigene Quellen offen lassen + deklarieren / Nur-Owner-Wissen ehrlich ansagen /
// oeffentlich pruefbar gar nicht erwaehnen - die GQ-B1-Pauschale ist owner-revidiert),
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
// aber nicht so knapp, dass eine Wortwahl-Korrektur ihn reisst.
// P4a (benannter Grund): place_call.language ist neu (LANG-15 aufgehoben, F-2) und
// traegt Katalog + Ablehnungssemantik + die Grenze zur Offenlegung - das treibt den
// Deckel messbar nach oben (gemessen: 6139 von 6300 ohne Kanal, 6541 von 6700 mit
// Kanal). Etwas Luft bleibt, damit eine reine Wortwahl-Korrektur ihn nicht reisst.
// T2-13 (benannter Grund, N-10): confirmation_code ist ein neues Pflichtfeld
// (Geldpfad-Bestaetigung, nur im Handler durchgesetzt - s. Schema-Kommentar in
// mcp-tools.js) - der erste Satz der Beschreibung UND die Feldbeschreibung muessen die
// Pflicht + die Sequenz (erst prepare_call, gleiche Argumente) nennen. Das treibt den
// Deckel weiter nach oben (gemessen: 6606 von 6700 ohne Kanal). Etwas Luft bleibt.
const PLACE_CALL_BUDGET_CHARS = 6700;
const PLACE_CALL_WITH_CONSULT_BUDGET_CHARS = 7100;
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

test("GQ-B1-01: die briefing-Beschreibung untersagt die erfundene Antwort und nennt kein kanalabhaengiges Werkzeug", () => {
  const briefing = captureDescriptions().get("place_call.briefing");
  assert.match(briefing, /never script an answer/i, "untersagt die erfundene Antwort");
  // Die offene Luecke und die drei Klassen pinnt GQ-B2-01 - hier steht nur, was diese
  // Phase unabhaengig davon garantiert.
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
  // GQ-B2 Fix-Runde 1 (Owner-Revision): die GQ-B1-Begruendung "anderer Pfad, anderer
  // Zeitpunkt, dort ist die Rueckfrage richtig" ist ueberholt - der Owner ist waehrend
  // des Anrufs ABWESEND, deshalb traegt answer_consult den Wortlaut NICHT mehr weiter
  // (siehe GQ-B2-05 unten, pfad-uebergreifend gepinnt). Die Praefix-Einschraenkung auf
  // place_call* bleibt trotzdem bestehen: sie ist der einzige Ort, an dem die
  // Vorab-Rueckfrage VOR dem Anruf ueberhaupt zulaessig ist.
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
  // T-21: der Satz bleibt erhalten, nur seine POSITION aendert sich - der Geld-Satz
  // (MCP_BASE_INSTRUCTIONS) muss nach vorn (Wichtigstes in die ersten 512 Zeichen).
  // Ein startsWith-Pin und T-21 schliessen einander aus.
  assert.ok(
    consultInstructions.includes("While a call placed with place_call is running"),
    "der Bestandssatz bleibt erhalten",
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

// GQ-B2 - Owner-Revision (2026-08-19): der Auftraggeber ist waehrend des Anrufs ABWESEND.
// Die GQ-B1-Pauschale verbrannte die eine gedeckelte Rueckfrage auf Fragen, die auch der
// auftraggebende Assistent nicht beantworten kann. Diese vier Faelle halten die Revision
// fest - zwei am Briefing, zwei an den Server-Instructions.

test("GQ-B2-01: die briefing-Beschreibung traegt alle drei Klassen der Wissensluecke", () => {
  const briefing = captureDescriptions().get("place_call.briefing");
  assert.match(briefing, /leave the gap open/i, "Klasse 1: die Luecke bleibt offen");
  assert.match(briefing, /declare that in one line/i, "Klasse 1: sie wird deklariert");
  assert.match(briefing, /only the principal know it/i, "Klasse 2: nur der Owner weiss es");
  assert.match(briefing, /get back on it/i, "Klasse 2: die ehrliche Prozess-Auskunft");
  assert.match(briefing, /look it up/i, "Klasse 3: oeffentlich pruefbar");
  assert.match(briefing, /write nothing/i, "Klasse 3: kein Wort dazu ins Briefing");
});

test("GQ-B2-02: die briefing-Beschreibung traegt das GQ-B1-Pauschal-Verbot NICHT mehr", () => {
  const briefing = captureDescriptions().get("place_call.briefing");
  assert.doesNotMatch(
    briefing,
    /never write that the principal will get back/i,
    "die Pauschale ist owner-revidiert",
  );
  assert.doesNotMatch(briefing, /pre-empt/i, "auch ihre Begruendung ist weg");
});

test("GQ-B2-03: die Server-Instructions nennen die eigenen Quellen zuerst und den Unbekannt-Ausgang", () => {
  assert.match(
    consultInstructions,
    /answer from your own tools and context first/i,
    "der eigene Weg steht vor jeder Nutzer-Rueckfrage",
  );
  assert.match(
    consultInstructions,
    /say with answer_consult that you do not know/i,
    "der Unbekannt-Ausgang ist ausdruecklich",
  );
  assert.match(consultInstructions, /instead of waiting/i, "Schweigen ist keine Antwort");
});

test("GQ-B2-04: die Server-Instructions kennen keine unbedingte Vorab-Rueckfrage mehr", () => {
  assert.doesNotMatch(
    consultInstructions,
    /ask the user first/i,
    "der Owner ist im Normalfall abwesend",
  );
  assert.match(
    consultInstructions,
    /only ask the user when they are actually present/i,
    "die Nutzer-Rueckfrage ist an Anwesenheit gebunden",
  );
});

test("GQ-B2-05: answer_consult traegt keine unbedingte Vorab-Rueckfrage mehr (pfad-uebergreifend)", () => {
  // Naeherer Entscheidungspunkt als die Server-Instructions (call-quality-chain-Lehre:
  // enge Anweisungen an der Tool-Beschreibung wirken dort, wo breite Regeln kippen).
  // Ein widerspruechlicher Satz hier wuerde GQ-B2-03/04 unterlaufen, obwohl beide gruen
  // sind - deshalb pinnt dieser Fall answer_consult direkt statt nur consultInstructions.
  const answerConsult = captureDescriptions(CONSULT_CTX).get("answer_consult");
  assert.doesNotMatch(
    answerConsult,
    /ask the user first/i,
    "der Owner ist waehrend des Anrufs abwesend, wie in MCP_CONSULT_INSTRUCTIONS",
  );
  assert.match(
    answerConsult,
    /do not know, say so honestly/i,
    "der Unbekannt-Ausgang ist ausdruecklich, wie in MCP_CONSULT_INSTRUCTIONS",
  );
});
