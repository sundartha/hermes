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
let fetchOpeningLine, validOpeningLine, verifiedOpeningLine, OPENING_LINE_MAX_CHARS;
let openingLineHash;

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
  ({ validOpeningLine, verifiedOpeningLine, OPENING_LINE_MAX_CHARS } = await import(
    "../src/elevenlabs/opening-line.js"
  ));
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
  assert.equal(line, GENERATED_DE);
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
  assert.equal(line, "Es geht um Folgendes: Termin zur Bremsenprüfung vereinbaren.");
});

test("fetchOpeningLine: LLM-Fehler -> Stufe 2; ASCII-Auftrag bleibt ASCII (ehrlich, nie umgeschrieben)", async () => {
  mode = "error500";
  const { line, source } = await fetchOpeningLine(args({ objective: "Termin fuer eine Bremsenpruefung vereinbaren" }));
  assert.equal(source, "auftrag");
  assert.equal(line, "Es geht um Folgendes: Termin fuer eine Bremsenpruefung vereinbaren.");
});

test("fetchOpeningLine: Erzeugung UND Auftrag unbrauchbar -> feste Kurzzeile (Stufe 3)", async () => {
  mode = "error500";
  const langerAuftrag = "sehr ".repeat(WORT_WIEDERHOLUNGEN) + "langer Auftrag";
  const { line, source } = await fetchOpeningLine(args({ objective: langerAuftrag }));
  assert.equal(source, "fest");
  assert.equal(line, localeFor("de").openingReasonFallback);
  assert.ok(validOpeningLine(line), "die feste Zeile besteht ihre eigene Pruefung");
});

test("fetchOpeningLine: Ich-Satz-Auftrag laeuft ohne Bruecken-Rahmen (bridgePhrase-Zweig)", async () => {
  mode = "error500";
  const { line } = await fetchOpeningLine(args({ objective: "Ich möchte einen Herrenhaarschnitt buchen" }));
  assert.equal(line, "Ich möchte einen Herrenhaarschnitt buchen.");
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
  assert.equal(spoken, "Es geht um Folgendes: Termin zur Bremsenprüfung vereinbaren.");
});

test("verifiedOpeningLine: halber Datensatz (Hash weg) -> Rueckfall, nie die unverbuergte Zeile", () => {
  const call = seededCall(GENERATED_DE);
  call.openingLineSha256 = null;
  const spoken = verifiedOpeningLine({ call, locale: localeFor("de") });
  assert.equal(spoken, "Es geht um Folgendes: Termin zur Bremsenprüfung vereinbaren.");
});

test("verifiedOpeningLine: Alt-Datensatz ohne Zeile -> stiller deterministischer Rueckfall", () => {
  const call = seededCall(null);
  assert.equal(call.openingLine, null);
  assert.equal(call.openingLineSha256, null);
  const spoken = verifiedOpeningLine({ call, locale: localeFor("de") });
  assert.equal(spoken, "Es geht um Folgendes: Termin zur Bremsenprüfung vereinbaren.");
});

test("verifiedOpeningLine: unbrauchbares goal am Alt-Datensatz -> feste Kurzzeile", () => {
  const call = seededCall(null);
  call.goal = "x".repeat(UEBERLANGE_ZEICHEN);
  const spoken = verifiedOpeningLine({ call, locale: localeFor("de") });
  assert.equal(spoken, localeFor("de").openingReasonFallback);
});

// ---- Nachbesserungen aus der unabhaengigen Durchsicht (2026-08-19) -------------------

test("validOpeningLine: Rotprobe Fragezeichen-Ende - vor der festen Frage darf keine zweite stehen", () => {
  assert.equal(validOpeningLine("Haben Sie kurz Zeit für die Bremsenprüfung?"), null);
});

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
    assert.equal(line, "Es geht um Folgendes: Termin zur Bremsenprüfung vereinbaren.");
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

