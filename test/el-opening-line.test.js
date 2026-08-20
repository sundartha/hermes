// Thema A (Auftrag 2026-08-19): die Eroeffnungszeile des ElevenLabs-Wegs
// (src/elevenlabs/opening-line.js). Rein in-process, dieselbe Naht wie
// cq-p8-briefing.test.js: ANTHROPIC_BASE_URL + DATA_DIR VOR dem ersten
// config-Import, dann dynamischer Import; der lokale HTTP-Mock ersetzt den
// Anthropic-Endpunkt.
//
// JEDER WAECHTER MIT ROTPROBE (Auftrags-Qualitaetsregel 1): fuer jede Ablehnung
// der Validierung gibt es den Fall, der sie auslost - zu lang, Klammern,
// Zeilenumbruch, fehlender Satz-Schluss, Preisangabe, Offenlegungs-Wiederholung -
// und fuer die Hash-Gegenprobe (A6) die absichtliche Mutation des gespeicherten
// Texts. Die Anbieter-Antwortform des Mocks ist die dokumentierte
// Anthropic-tool_use-Form (dieselbe wie in cq-p8-briefing.test.js, dort gegen die
// echte API belegt); die ERZEUGTEN Zeileninhalte sind Testdaten, kein
// aufgezeichnetes Anbieter-Verhalten.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { tempDataDir, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Antonio Fotiadis";
const TIMEOUT_MS = 50;
const HTTP_ERROR = 500;
// Deutlich ueber OPENING_LINE_MAX_CHARS, damit auch Stufe 2 der Treppe faellt.
const WORT_WIEDERHOLUNGEN = 40;
const UEBERLANGE_ZEICHEN = 200;
// Der Mock meldet 25 Output-Tokens; der Abbruch-Pfad schaetzt OPENING_MAX_TOKENS=100.
const MOCK_OUTPUT_TOKENS = 25;
const ABBRUCH_SCHAETZUNG_TOKENS = 100;

// Gute DE-Zeile MIT Umlauten - der Kernfall von Auflage A6 (Umlaute ueberleben).
const GENERATED_DE = "Ich rufe an, um einen Termin zur Bremsenprüfung zu vereinbaren.";

// Je Sprache eine Zeile, die SELBST fragt (Eingabe fuer GQ-E1-02/07/08). Kein
// Anbieter-Verhalten, Testdaten - aber jede muss validOpeningLine bestehen.
const FRAGE_ZEILE = Object.freeze({
  de: "Hast du morgen um 15 Uhr Zeit?",
  fr: "As-tu le temps demain à 15 heures ?",
  en: "Do you have time tomorrow at 3 pm?",
});

// Sprachen mit grammatischer Anredeform (GQ-E1-04). Englisch ist ausgenommen: "you"/
// "your" tragen kein Register, es gibt dort keine Du/Sie-Wahl, an der etwas brechen
// koennte.
const SPRACHEN_MIT_ANREDEFORM = ["de", "fr"];
// Platzhalter-Auftrag fuer bridgePhrase: traegt selbst kein Pronomen und loest den
// Ich-Satz-Passthrough nicht aus (er beginnt nicht mit "ich"/"je"/"I").
const SENTINEL = "XGOALX";
const ANREDE_MUSTER = Object.freeze({
  de: /\b(Sie|Ihnen|Ihr\w*|du|dir|dich|dein\w*)\b/,
  fr: /\b(vous|votre|vos|tu|te|toi|ton|ta|tes)\b/i,
});
// Die beiden Platzhalter des ANBIETERS im statischen Rahmen (providerOpeningFor).
const OPENING_LINE_VARIABLE = "{{opening_line}}";
const OWNER_NAME_VARIABLE = "{{owner_name}}";

let mode = "toolUse";
let nextReason = GENERATED_DE;
let requestCount = 0;
let lastRequest = null;

function anthropicToolMessage(reason) {
  return {
    id: "msg_opening_mock",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [{ type: "tool_use", id: "tu_opening", name: "eroeffnungszeile", input: { reason } }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 60, output_tokens: 25 },
  };
}

let server;
let store;
let config;
let localeFor;
let SUPPORTED_LANGUAGES;
let usageFor;
let fetchOpeningLine, composedOpeningLine, validOpeningLine, verifiedOpeningLine;
let OPENING_LINE_MAX_CHARS, OPENING_QUESTION_MAX_CHARS;
let providerOpeningFor;
let openingLineHash;

// Erwartung IMMER aus LOCALES gebaut, nie getippt: sonst pinnt der Test den Wortlaut
// ein zweites Mal und die vier gestrichenen Anrede-Teile muessten hier nachgepflegt
// werden.
const komponiert = (reason, lang) => composedOpeningLine(reason, localeFor(lang));

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requestCount += 1;
      lastRequest = JSON.parse(body);
      if (mode === "error500") {
        res.writeHead(HTTP_ERROR, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }));
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(anthropicToolMessage(nextReason)));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-opening-key";
  process.env.PRECALL_BRIEFING_TIMEOUT_MS = String(TIMEOUT_MS);
  process.env.LLM_BREAKER_THRESHOLD = "100"; // Reihenfolge-Unabhaengigkeit (Muster P8)
  process.env.DATA_DIR = tempDataDir(
    seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }] }),
  );
  store = await import("../src/store.js");
  ({ config } = await import("../src/config.js"));
  ({ localeFor, SUPPORTED_LANGUAGES } = await import("../src/i18n/locales.js"));
  ({ usageFor } = await import("../src/store/state-ops.js"));
  ({
    composedOpeningLine,
    validOpeningLine,
    verifiedOpeningLine,
    OPENING_LINE_MAX_CHARS,
    OPENING_QUESTION_MAX_CHARS,
  } = await import("../src/elevenlabs/opening-line.js"));
  ({ providerOpeningFor } = await import("../src/elevenlabs/call-locale.js"));
  ({ fetchOpeningLine } = await import("../src/elevenlabs/opening-line-llm.js"));
  ({ openingLineHash } = await import("../src/store/state-ops.js"));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  mode = "toolUse";
  nextReason = GENERATED_DE;
  lastRequest = null;
});

const args = (over = {}) => ({
  objective: "Termin zur Bremsenprüfung vereinbaren",
  tenantId: BOOTSTRAP_TENANT_ID,
  locale: localeFor("de"),
  ...over,
});

// ---- Validierung: der Gut-Fall und JEDE Rotprobe ------------------------------------

test("validOpeningLine: gute Zeile mit Umlauten kommt byte-identisch zurueck", () => {
  assert.equal(validOpeningLine(GENERATED_DE), GENERATED_DE);
  assert.equal(validOpeningLine("J'appelle pour réserver une table."), "J'appelle pour réserver une table.");
});

test("validOpeningLine: Grenze exakt - 120 Zeichen bestehen, 121 fallen (A2)", () => {
  const exakt = "a".repeat(OPENING_LINE_MAX_CHARS - 1) + ".";
  assert.equal(validOpeningLine(exakt), exakt);
  const drueber = "a".repeat(OPENING_LINE_MAX_CHARS) + ".";
  assert.equal(validOpeningLine(drueber), null, "121 Zeichen muessen abgelehnt werden");
});

test("validOpeningLine: Rotproben - Klammern, Umbruch, Satz-Schluss, Leeres", () => {
  assert.equal(validOpeningLine("Ich rufe an [warm] wegen des Termins."), null, "Ton-Marke");
  assert.equal(validOpeningLine("Ich rufe an wegen {{objective}}."), null, "Platzhalter");
  assert.equal(validOpeningLine("Ich rufe an,\nwegen des Termins."), null, "Zeilenumbruch");
  assert.equal(validOpeningLine("Ich rufe an wegen des Termins"), null, "kein Satz-Schluss");
  assert.equal(validOpeningLine("   "), null, "nur Leerraum");
  assert.equal(validOpeningLine(null), null, "kein String");
});

test("validOpeningLine: Rotprobe Preisangabe (A4) - beziffert faellt, unbeziffert nicht", () => {
  assert.equal(validOpeningLine("Ich rufe wegen des Angebots für 49 Euro an."), null);
  assert.equal(validOpeningLine("I am calling about the $20 offer."), null);
  assert.equal(validOpeningLine("Ich rufe an, um einen Preis zu erfragen."), "Ich rufe an, um einen Preis zu erfragen.");
});

test("validOpeningLine: Rotprobe Offenlegungs-Wiederholung (A3), alle drei Sprachen", () => {
  assert.equal(validOpeningLine("Hier spricht ein KI-Assistent im Auftrag von Antonio, es geht um den Termin."), null);
  assert.equal(validOpeningLine("This is an AI assistant calling on behalf of Antonio about the visit."), null);
  assert.equal(validOpeningLine("Ceci est un assistant IA mandaté par Antonio pour un rendez-vous."), null);
});

// ---- Die Treppe (A3): erzeugt -> Auftrag -> feste Zeile ------------------------------

test("fetchOpeningLine: erzeugte Zeile gewinnt und Umlaute ueberleben byte-genau (A6)", async () => {
  const { line, source } = await fetchOpeningLine(args());
  assert.equal(source, "erzeugt");
  assert.equal(line, komponiert(GENERATED_DE, "de"));
});

test("fetchOpeningLine: Injektions-Grenze - Auftrag NUR in der user-Message, nie im System-Block", async () => {
  await fetchOpeningLine(args({ objective: "Blumen bestellen fuer Freitag" }));
  const system = Array.isArray(lastRequest.system)
    ? lastRequest.system.map((block) => block.text).join("\n")
    : lastRequest.system;
  assert.ok(!system.includes("Blumen bestellen"), "Auftragstext darf nicht im System-Block stehen");
  assert.ok(system.includes("No prices"), "A4-Anweisung (keine Preise/Zusagen) ist gepinnt");
  assert.ok(system.includes("umlauts"), "Orthografie-Anweisung (A6) ist gepinnt");
  const userText = JSON.stringify(lastRequest.messages);
  assert.ok(userText.includes("Blumen bestellen"), "Auftrag steht in der user-Message");
});

test("fetchOpeningLine: unbrauchbare Erzeugung -> Stufe 2, WORTGLEICH der Anruf-8-Wortlaut", async () => {
  nextReason = "Ich rufe an [thoughtful] wegen der Bremsenprüfung.";
  const { line, source } = await fetchOpeningLine(args());
  assert.equal(source, "auftrag");
  assert.equal(line, komponiert("Es geht um Folgendes: Termin zur Bremsenprüfung vereinbaren.", "de"));
});

test("fetchOpeningLine: LLM-Fehler -> Stufe 2; ASCII-Auftrag bleibt ASCII (ehrlich, nie umgeschrieben)", async () => {
  mode = "error500";
  const { line, source } = await fetchOpeningLine(args({ objective: "Termin fuer eine Bremsenpruefung vereinbaren" }));
  assert.equal(source, "auftrag");
  assert.equal(line, komponiert("Es geht um Folgendes: Termin fuer eine Bremsenpruefung vereinbaren.", "de"));
});

test("fetchOpeningLine: Erzeugung UND Auftrag unbrauchbar -> feste Kurzzeile (Stufe 3)", async () => {
  mode = "error500";
  const langerAuftrag = "sehr ".repeat(WORT_WIEDERHOLUNGEN) + "langer Auftrag";
  const { line, source } = await fetchOpeningLine(args({ objective: langerAuftrag }));
  assert.equal(source, "fest");
  assert.equal(line, komponiert(localeFor("de").openingReasonFallback, "de"));
  assert.ok(validOpeningLine(line), "die feste Zeile besteht ihre eigene Pruefung");
});

test("fetchOpeningLine: Ich-Satz-Auftrag laeuft ohne Bruecken-Rahmen (bridgePhrase-Zweig)", async () => {
  mode = "error500";
  const { line } = await fetchOpeningLine(args({ objective: "Ich möchte einen Herrenhaarschnitt buchen" }));
  assert.equal(line, komponiert("Ich möchte einen Herrenhaarschnitt buchen.", "de"));
});

// ---- Hash-Gegenprobe am Anrufstart (A6) ---------------------------------------------

function seededCall(openingLine) {
  return store.createCall({
    direction: "outbound",
    from: "+15550001111",
    to: "+4915112345678",
    goal: "Termin zur Bremsenprüfung vereinbaren",
    openingLine,
    tenantId: BOOTSTRAP_TENANT_ID,
  });
}

test("createCall: Hash entsteht im Store, exakt sha256 der Zeile", () => {
  const call = seededCall(GENERATED_DE);
  assert.equal(call.openingLine, GENERATED_DE);
  assert.equal(
    call.openingLineSha256,
    crypto.createHash("sha256").update(GENERATED_DE, "utf8").digest("hex"),
  );
  assert.equal(call.openingLineSha256, openingLineHash(GENERATED_DE));
});

test("verifiedOpeningLine: unveraenderte Zeile wird gesprochen", () => {
  const call = seededCall(GENERATED_DE);
  assert.equal(verifiedOpeningLine({ call, locale: localeFor("de") }), GENERATED_DE);
});

test("verifiedOpeningLine: ROTPROBE - mutierte Zeile wird NIE gesprochen, Rueckfall greift", () => {
  const call = seededCall(GENERATED_DE);
  // Absichtliche Verfaelschung ZWISCHEN Annahme und Anruf - exakt der Fall aus dem
  // Auftrag (ein Treiber transliteriert die Umlaute weg).
  call.openingLine = "Ich rufe an, um einen Termin zur Bremsenpruefung zu vereinbaren.";
  const spoken = verifiedOpeningLine({ call, locale: localeFor("de") });
  assert.notEqual(spoken, call.openingLine, "die veraenderte Zeile darf nicht gesprochen werden");
  assert.equal(spoken, komponiert("Es geht um Folgendes: Termin zur Bremsenprüfung vereinbaren.", "de"));
});

test("verifiedOpeningLine: halber Datensatz (Hash weg) -> Rueckfall, nie die unverbuergte Zeile", () => {
  const call = seededCall(GENERATED_DE);
  call.openingLineSha256 = null;
  const spoken = verifiedOpeningLine({ call, locale: localeFor("de") });
  assert.equal(spoken, komponiert("Es geht um Folgendes: Termin zur Bremsenprüfung vereinbaren.", "de"));
});

test("verifiedOpeningLine: Alt-Datensatz ohne Zeile -> stiller deterministischer Rueckfall", () => {
  const call = seededCall(null);
  assert.equal(call.openingLine, null);
  assert.equal(call.openingLineSha256, null);
  const spoken = verifiedOpeningLine({ call, locale: localeFor("de") });
  assert.equal(spoken, komponiert("Es geht um Folgendes: Termin zur Bremsenprüfung vereinbaren.", "de"));
});

test("verifiedOpeningLine: unbrauchbares goal am Alt-Datensatz -> feste Kurzzeile", () => {
  const call = seededCall(null);
  call.goal = "x".repeat(UEBERLANGE_ZEICHEN);
  const spoken = verifiedOpeningLine({ call, locale: localeFor("de") });
  assert.equal(spoken, komponiert(localeFor("de").openingReasonFallback, "de"));
});

// ---- Nachbesserungen aus der unabhaengigen Durchsicht (2026-08-19) -------------------

test("openingReasonFallback: JEDE Sprache fuehrt eine feste Kurzzeile, die ihre eigene Pruefung besteht", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const zeile = localeFor(lang).openingReasonFallback;
    assert.equal(typeof zeile, "string", `Sprache ${lang}: Kurzzeile fehlt`);
    assert.equal(validOpeningLine(zeile), zeile, `Sprache ${lang}: Kurzzeile faellt durch`);
  }
});

test("Notaus (R5): openingLineLlm=false -> KEIN LLM-Aufruf, Treppe ab Stufe 2", async () => {
  const vorher = requestCount;
  config.voice.elevenLabsOutbound.openingLineLlm = false;
  try {
    const { line, source } = await fetchOpeningLine(args());
    assert.equal(source, "auftrag");
    assert.equal(line, komponiert("Es geht um Folgendes: Termin zur Bremsenprüfung vereinbaren.", "de"));
    assert.equal(requestCount, vorher, "abgeschaltet darf kein einziger Request rausgehen");
  } finally {
    config.voice.elevenLabsOutbound.openingLineLlm = true;
  }
});

test("Kostenbuchung (R2/A7): der Gut-Fall bucht die gemeldeten Tokens auf den Tenant-Bucket", async () => {
  const vorher = usageFor(store.load(), BOOTSTRAP_TENANT_ID).outputTokens;
  await fetchOpeningLine(args());
  const nachher = usageFor(store.load(), BOOTSTRAP_TENANT_ID).outputTokens;
  assert.equal(nachher - vorher, MOCK_OUTPUT_TOKENS, "genau die gemeldeten Output-Tokens muessen gebucht sein");
});

test("Kostenbuchung (R2/AL-P9): der 5xx-Abbruch bucht die pessimistische Schaetzung, nie 0", async () => {
  mode = "error500";
  const vorher = usageFor(store.load(), BOOTSTRAP_TENANT_ID).outputTokens;
  await fetchOpeningLine(args());
  const nachher = usageFor(store.load(), BOOTSTRAP_TENANT_ID).outputTokens;
  assert.equal(nachher - vorher, ABBRUCH_SCHAETZUNG_TOKENS, "OPENING_MAX_TOKENS als Output-Schaetzung (estimatedAbortUsage)");
});

// ---- GQ-E1 (Thema E): die Eroeffnung ist EIN kohaerenter gesprochener Satz -----------
// Befund call_mt0ddduxuzgl: der Auftrag duzte, die feste Frage siezte, und zwischen
// beiden stand ein Doppelpunkt-Rahmen. Gesprochen wurde daraus ein Register-Bruch mit
// zwei Fragen. Die Faelle unten nageln die drei Zusagen fest, aus denen der Fix besteht:
// die Bausteine tragen keine Anrede, die Zeile darf selbst fragen, und komponiert wird
// genau einmal - an EINER Stelle.

test("GQ-E1-01: der Befundfall aus call_mt0ddduxuzgl, byte-genau", async () => {
  // Regressionsanker: EXAKT der Auftrag, der am 19.08. den Bruch erzeugt hat. Notaus an
  // (Muster des Notaus-Falls oben), damit die Treppe deterministisch auf Stufe 2 faellt.
  config.voice.elevenLabsOutbound.openingLineLlm = false;
  try {
    const { line } = await fetchOpeningLine(
      args({ objective: "Ich wollte fragen, ob du morgen um 15 Uhr Zeit für eine Runde Tennis hast." }),
    );
    assert.equal(
      line,
      "Ich wollte fragen, ob du morgen um 15 Uhr Zeit für eine Runde Tennis hast. Wie sieht es damit aus?",
    );
    assert.ok(!line.includes(".."), "kein doppeltes Satzzeichen an der Nahtstelle");
    assert.ok(!line.includes("Ihnen"), "kein Sie-Baustein hinter einem duzenden Auftrag");
    assert.equal(line.split("?").length - 1, 1, "genau EINE Frage in der Aeusserung");
  } finally {
    config.voice.elevenLabsOutbound.openingLineLlm = true;
  }
});

test("GQ-E1-02: eine Zeile, die am Ende fragt, ist gueltig", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.equal(
      validOpeningLine(FRAGE_ZEILE[lang]),
      FRAGE_ZEILE[lang],
      `Sprache ${lang}: eine Zeile, die selbst fragt, muss die Pruefung bestehen`,
    );
  }
});

test("GQ-E1-03: Rotprobe - zwei Fragen oder ein Fragezeichen mitten im Satz sind ungueltig", () => {
  assert.equal(validOpeningLine("Hast du Zeit? Und am Freitag?"), null, "zwei Fragen");
  assert.equal(
    validOpeningLine("Wie geht es? Ich rufe wegen des Termins an."),
    null,
    "Fragezeichen mitten im Satz",
  );
});

test("GQ-E1-04: die festen Eroeffnungs-Bausteine tragen kein Anrede-Pronomen (de/fr)", () => {
  for (const lang of SPRACHEN_MIT_ANREDEFORM) {
    const locale = localeFor(lang);
    const bausteine = {
      openingQuestion: locale.openingQuestion,
      openingReasonFallback: locale.openingReasonFallback,
      bridgePhrase: locale.bridgePhrase(SENTINEL),
    };
    for (const [name, wert] of Object.entries(bausteine)) {
      assert.ok(
        !ANREDE_MUSTER[lang].test(wert),
        `Sprache ${lang}, Baustein ${name}: "${wert}" traegt ein Anrede-Pronomen. Ein ` +
          "fester Baustein steht hinter einer Zeile, deren Anrede aus dem AUFTRAG kommt " +
          "- genau daran brach der Befund call_mt0ddduxuzgl (Auftrag duzte, Baustein siezte).",
      );
    }
  }
});

test("GQ-E1-06: Deckel-Arithmetik der Eroeffnung", () => {
  // Die Zusage "die Eroeffnung endet auf eine Frage" haengt seit GQ-E1 allein an diesem
  // Wert: hinter der Variablen steht am Anbieter kein statischer Text mehr (E-P8).
  for (const lang of SUPPORTED_LANGUAGES) {
    const frage = localeFor(lang).openingQuestion;
    assert.ok(frage, `Sprache ${lang}: feste Frage fehlt`);
    assert.ok(frage.endsWith("?"), `Sprache ${lang}: die feste Frage muss fragen`);
    assert.equal(validOpeningLine(frage), frage, `Sprache ${lang}: die feste Frage faellt durch`);
    assert.ok(
      frage.length <= OPENING_QUESTION_MAX_CHARS,
      `Sprache ${lang}: die feste Frage sprengt den Deckel (${frage.length} Zeichen)`,
    );
    const laengsteZeile = "a".repeat(OPENING_LINE_MAX_CHARS - 1) + ".";
    assert.ok(
      OPENING_LINE_MAX_CHARS + 1 + OPENING_QUESTION_MAX_CHARS >= komponiert(laengsteZeile, lang).length,
      `Sprache ${lang}: die komponierte Zeile sprengt die festgehaltene Obergrenze`,
    );
  }
});

test("GQ-E1-07: der GANZE gesprochene Satz, je Sprache und in beiden Faellen", () => {
  // Der Fall, der den Befund vom 19.08. gefangen haette: Rahmen und Variable waren bis
  // dahin nur je fuer sich geprueft, nie zusammengesetzt (E-P6).
  for (const lang of SUPPORTED_LANGUAGES) {
    const locale = localeFor(lang);
    for (const reason of [locale.openingReasonFallback, FRAGE_ZEILE[lang]]) {
      const gesprochen = providerOpeningFor(lang).replace(
        OPENING_LINE_VARIABLE,
        komponiert(reason, lang),
      );
      assert.ok(
        gesprochen.startsWith(locale.disclosure(OWNER_NAME_VARIABLE)),
        `Sprache ${lang}: die Offenlegung steht am Anfang (Artikel 50 EU AI Act)`,
      );
      assert.equal(
        gesprochen.split("?").length - 1,
        1,
        `Sprache ${lang}: genau EINE Frage in der ganzen Eroeffnung ("${gesprochen}")`,
      );
      assert.ok(
        !/[.!?]{2}/.test(gesprochen),
        `Sprache ${lang}: kein doppeltes Satzzeichen ("${gesprochen}")`,
      );
      assert.ok(gesprochen.endsWith("?"), `Sprache ${lang}: die Eroeffnung endet auf die Frage`);
    }
  }
});

test("GQ-E1-08: Komposition, beide Richtungen, je Sprache", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const locale = localeFor(lang);
    const aussage = locale.openingReasonFallback;
    assert.equal(
      komponiert(aussage, lang),
      `${aussage} ${locale.openingQuestion}`,
      `Sprache ${lang}: eine Aussage bekommt die feste Frage`,
    );
    assert.equal(
      komponiert(FRAGE_ZEILE[lang], lang),
      FRAGE_ZEILE[lang],
      `Sprache ${lang}: eine Zeile, die selbst fragt, bleibt byte-identisch`,
    );
  }
});

test("GQ-E1-09: Stufe 2 mit Frage-Auftrag laeuft ohne Bruecken-Rahmen", async () => {
  mode = "error500";
  const auftrag = "Hast du morgen um 15 Uhr Zeit für eine Runde Tennis?";
  const { line, source } = await fetchOpeningLine(args({ objective: auftrag }));
  assert.equal(source, "auftrag");
  assert.equal(line, auftrag, "der Auftrag IST bereits die sprechbare Frage");
  assert.ok(!line.includes("Es geht um Folgendes:"), "kein Bruecken-Rahmen vor einer Frage");
});

test("GQ-E1-10: Stufe 3 wird komponiert", async () => {
  mode = "error500";
  const langerAuftrag = "sehr ".repeat(WORT_WIEDERHOLUNGEN) + "langer Auftrag";
  for (const lang of SUPPORTED_LANGUAGES) {
    const locale = localeFor(lang);
    const { line, source } = await fetchOpeningLine(args({ objective: langerAuftrag, locale }));
    assert.equal(source, "fest", `Sprache ${lang}: die Treppe muss auf Stufe 3 fallen`);
    assert.equal(
      line,
      `${locale.openingReasonFallback} ${locale.openingQuestion}`,
      `Sprache ${lang}: auch die feste Kurzzeile wird komponiert`,
    );
  }
});

test("GQ-E1-11: Prompt-Pin der Erzeugung", async () => {
  await fetchOpeningLine(args({ objective: "Blumen bestellen fuer Freitag" }));
  const system = Array.isArray(lastRequest.system)
    ? lastRequest.system.map((block) => block.text).join("\n")
    : lastRequest.system;
  assert.ok(system.includes("question mark"), "die Frage-Form ist im System-Block gepinnt");
  assert.ok(
    system.includes("Mirror the form of address"),
    "die Anrede-Spiegelung ist im System-Block gepinnt",
  );
  assert.ok(!system.includes("Blumen bestellen"), "der Auftrag steht weiterhin NUR in der user-Message");
});

