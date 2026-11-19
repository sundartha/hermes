import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { tempDataDir, seedState } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";

const OWNER = "Antonio Fotiadis";
const TIMEOUT_MS = 2000;
const HTTP_ERROR = 500;
const WORT_WIEDERHOLUNGEN = 40;
const UEBERLANGE_ZEICHEN = 200;
const MOCK_OUTPUT_TOKENS = 25;
const ABBRUCH_SCHAETZUNG_TOKENS = 100;

const GENERATED_DE = "Ich rufe an, um einen Termin zur Bremsenprüfung zu vereinbaren.";

const FRAGE_ZEILE = Object.freeze({
  de: "Hast du morgen um 15 Uhr Zeit?",
  fr: "As-tu le temps demain à 15 heures ?",
  en: "Do you have time tomorrow at 3 pm?",
});

const SPRACHEN_MIT_ANREDEFORM = ["de", "fr"];
const SENTINEL = "XGOALX";
const ANREDE_MUSTER = Object.freeze({
  de: /\b(Sie|Ihnen|Ihr\w*|du|dir|dich|dein\w*)\b/,
  fr: /\b(vous|votre|vos|tu|te|toi|ton|ta|tes)\b/i,
});
const KI_HINWEIS = Object.freeze({
  de: "ich bin Hermes, der KI-Assistent von",
  fr: "je suis Hermes, l'assistant IA de",
  en: "I am Hermes, the AI assistant of",
});

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
let localeFor, afterGreeting;
let SUPPORTED_LANGUAGES;
let usageFor;
let fetchOpeningLine, composedOpeningLine, validOpeningLine, verifiedOpeningLine;
let OPENING_LINE_MAX_CHARS, OPENING_QUESTION_MAX_CHARS;
let openingLineHash;

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
  process.env.LLM_BREAKER_THRESHOLD = "100";
  process.env.DATA_DIR = tempDataDir(
    seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }] }),
  );
  store = await import("../../src/store.js");
  ({ config } = await import("../../src/config.js"));
  ({ localeFor, SUPPORTED_LANGUAGES, afterGreeting } = await import("../../src/i18n/locales.ts"));
  ({ usageFor } = await import("../../src/store/state-ops.js"));
  ({
    composedOpeningLine,
    validOpeningLine,
    verifiedOpeningLine,
    OPENING_LINE_MAX_CHARS,
    OPENING_QUESTION_MAX_CHARS,
  } = await import("../../src/elevenlabs/opening-line.ts"));
  ({ fetchOpeningLine } = await import("../../src/elevenlabs/opening-line-llm.js"));
  ({ openingLineHash } = await import("../../src/store/state-ops.js"));
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

test("fetchOpeningLine: unbrauchbare Erzeugung -> fester Rueckfall, nie der Auftrag", async () => {
  nextReason = "Ich rufe an [thoughtful] wegen der Bremsenprüfung.";
  const { line, source } = await fetchOpeningLine(args());
  assert.equal(source, "fest");
  assert.equal(line, localeFor("de").openingReasonFallback);
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

test("GQ-E1-01: der Befundfall aus call_mt0ddduxuzgl, byte-genau", async () => {
  config.voice.elevenLabsOutbound.openingLineLlm = false;
  try {
    const { line } = await fetchOpeningLine(
      args({ objective: "Ich wollte fragen, ob du morgen um 15 Uhr Zeit für eine Runde Tennis hast." }),
    );
    assert.equal(
      line,
      "Ich wollte fragen, ob du morgen um 15 Uhr Zeit für eine Runde Tennis hast.",
    );
    assert.ok(!line.includes(".."), "kein doppeltes Satzzeichen an der Nahtstelle");
    assert.ok(!line.includes("Ihnen"), "kein Sie-Baustein hinter einem duzenden Auftrag");
    assert.equal(line.split("?").length - 1, 0, "keine Frage in der Anlasszeile");
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

test("GQ-E1-09: Frage-Auftrag wird nicht Anlasszeile, es gilt die feste Kurzzeile (#3488)", async () => {
  mode = "error500";
  const auftrag = "Hast du morgen um 15 Uhr Zeit für eine Runde Tennis?";
  const { line, source } = await fetchOpeningLine(args({ objective: auftrag }));
  assert.equal(source, "fest");
  assert.equal(line, localeFor("de").openingReasonFallback);
  assert.ok(!line.includes(auftrag), "die Frage stellt der Agent im naechsten Zug");
});

test("GQ-E1-10: Stufe 3 ist die feste Kurzzeile", async () => {
  mode = "error500";
  const langerAuftrag = "sehr ".repeat(WORT_WIEDERHOLUNGEN) + "langer Auftrag";
  for (const lang of SUPPORTED_LANGUAGES) {
    const locale = localeFor(lang);
    const { line, source } = await fetchOpeningLine(args({ objective: langerAuftrag, locale }));
    assert.equal(source, "fest", `Sprache ${lang}: die Treppe muss auf Stufe 3 fallen`);
    assert.equal(
      line,
      locale.openingReasonFallback,
      `Sprache ${lang}: die feste Kurzzeile bleibt ohne Schlussfrage`,
    );
  }
});

test("GQ-E1-11: Prompt-Pin der Erzeugung", async () => {
  await fetchOpeningLine(args({ objective: "Blumen bestellen fuer Freitag" }));
  const system = Array.isArray(lastRequest.system)
    ? lastRequest.system.map((block) => block.text).join("\n")
    : lastRequest.system;
  assert.ok(system.includes("never a question"), "die Aussage-Form ist im System-Block gepinnt (#3488)");
  assert.ok(
    system.includes("Mirror the form of address"),
    "die Anrede-Spiegelung ist im System-Block gepinnt",
  );
  assert.ok(!system.includes("Blumen bestellen"), "der Auftrag steht weiterhin NUR in der user-Message");
});


test("G2 (#3488): eine gespeicherte Zeile mit Schlussfrage wird nicht Anlass, es gilt der feste Rueckfall", () => {
  const alt = "Es geht um Folgendes: Altfall. Wie sieht es damit aus?";
  const spoken = verifiedOpeningLine({
    call: { id: "c-alt", goal: "Ich möchte etwas klären", openingLine: alt, openingLineSha256: openingLineHash(alt) },
    locale: localeFor("de"),
  });
  assert.equal(spoken, "Ich möchte etwas klären.");
});

test("G2 (#3488): eine gespeicherte Anlasszeile ohne Frage wird uebernommen", () => {
  const neu = "Ich rufe an, um den Altfall zu klären.";
  const spoken = verifiedOpeningLine({
    call: { id: "c-neu", goal: "etwas anderes", openingLine: neu, openingLineSha256: openingLineHash(neu) },
    locale: localeFor("de"),
  });
  assert.equal(spoken, neu);
});

test("G1 (#3488): der KI-Satz im Anlass ist je Sprache gesperrt, auch in der neuen Form", () => {
  for (const sprache of SUPPORTED_LANGUAGES) {
    const locale = localeFor(sprache);
    const mitKiSatz = `${locale.openingReasonFallback.slice(0, -1)}, ${KI_HINWEIS[sprache]} Max`;
    assert.equal(validOpeningLine(mitKiSatz), null, `Sprache ${sprache}`);
  }
});

test("E5 (#3488): die gespeicherte Anlasszeile eines Dritt-Anrufs traegt keine Schlussfrage, die des Eigene-Nummer-Anrufs schon", async () => {
  mode = "error500";
  const locale = localeFor("de");
  const objective = "Ich möchte einen Termin buchen";
  const dritt = await fetchOpeningLine(args({ objective }));
  const eigene = await fetchOpeningLine(args({ objective, calleeIsOwner: true }));
  assert.equal(dritt.line, "Ich möchte einen Termin buchen.");
  assert.equal(eigene.line, `Ich möchte einen Termin buchen. ${locale.openingQuestion}`);
});

function warnungenBeiVerifikation(call) {
  const original = console.warn;
  const warnungen = [];
  console.warn = (text) => warnungen.push(text);
  try {
    verifiedOpeningLine({ call, locale: localeFor("de") });
  } finally {
    console.warn = original;
  }
  return warnungen;
}

test("G2 (#3488): nur eine veraenderte oder halbe gespeicherte Zeile loest die Warnung aus, saubere und fehlende nicht", () => {
  const zeile = "Ich rufe an, um den Altfall zu klären.";
  const mitFrage = `${zeile} Worum geht es?`;
  const sauber = { id: "c-w1", goal: "Termin", openingLine: zeile, openingLineSha256: openingLineHash(zeile) };
  const frageGueltig = { id: "c-w2", goal: "Termin", openingLine: mitFrage, openingLineSha256: openingLineHash(mitFrage) };
  const verfaelscht = { id: "c-w3", goal: "Termin", openingLine: zeile, openingLineSha256: "x".repeat(64) };
  const nurZeile = { id: "c-w4", goal: "Termin", openingLine: zeile };
  const nurHash = { id: "c-w5", goal: "Termin", openingLineSha256: openingLineHash(zeile) };
  const nichts = { id: "c-w6", goal: "Termin" };
  assert.equal(warnungenBeiVerifikation(sauber).length, 0);
  assert.equal(warnungenBeiVerifikation(frageGueltig).length, 0);
  assert.equal(warnungenBeiVerifikation(nichts).length, 0);
  assert.equal(warnungenBeiVerifikation(verfaelscht).length, 1);
  assert.equal(warnungenBeiVerifikation(nurZeile).length, 1);
  assert.equal(warnungenBeiVerifikation(nurHash).length, 1);
});

test("validOpeningLine: Rotprobe KI-Satz-Praefix - der KI-Satz-Anfang kollidiert, Pruefung ist trimmed+lowercase (#3488)", () => {
  assert.equal(validOpeningLine("Ich bin der KI-Assistent von Herrn Mueller."), null);
});

test("validOpeningLine: der KI-Satz-Anfang sperrt auch am Zeilenende ohne folgendes Leerzeichen, je Sprache (#3488)", () => {
  assert.equal(validOpeningLine("Ich bin der KI-Assistent von."), null);
  assert.equal(validOpeningLine("I am the AI assistant of."), null);
  assert.equal(validOpeningLine("Je suis l'assistant IA de."), null);
});

test("afterGreeting: Tabelle - leerer Auftrag bleibt unveraendert, sonst Kleinschreibung ausser bei 'I ...' (#3488)", () => {
  assert.equal(afterGreeting(null), null);
  assert.equal(afterGreeting(undefined), undefined);
  assert.equal(afterGreeting("Ich rufe an."), "ich rufe an.");
  assert.equal(afterGreeting("I need a callback."), "I need a callback.");
  assert.equal(afterGreeting("Oh, I see what is needed."), "oh, I see what is needed.");
});

const ZEILEN_LOCALE = {
  bridgePhrase: (ziel) => `Ich rufe an, um ${ziel}.`,
  openingQuestion: "Haben Sie kurz Zeit?",
  openingReasonFallback: "Fallback-Anlass.",
};
const TISCH_ZIEL = "einen Tisch zu reservieren";
const TISCH_BRUECKE = "Ich rufe an, um einen Tisch zu reservieren.";

const gespeichertAm = (zeile, ueberschreibung = {}) => ({
  id: "call_x",
  goal: TISCH_ZIEL,
  openingLine: zeile,
  openingLineSha256: openingLineHash(zeile),
  ...ueberschreibung,
});

function mitAufgefangenerWarnung(aufruf) {
  const zeilen = [];
  const original = console.warn;
  console.warn = (...teile) => zeilen.push(teile.join(" "));
  try {
    return { wert: aufruf(), zeilen };
  } finally {
    console.warn = original;
  }
}

const ICH_FORMEN = [
  ["de", "Ich rufe an, um einen Termin zu vereinbaren.", "Ich rufe an, um einen Termin zu vereinbaren."],
  ["en", "I am calling to book a table.", "I am calling to book a table."],
  ["fr", "J’appelle pour réserver une table.", "J’appelle pour réserver une table."],
  ["de", "Ich rufe an, um einen Termin zu vereinbaren?", null],
  ["de", "Ich rufe an, um einen Termin zu vereinbaren!", null],
  ["de", "Ich rufe an, um einen Termin. Danach mehr.", null],
  ["de", "Wir rufen an, um einen Termin zu vereinbaren.", null],
  ["xx", "Ich rufe an, um einen Termin zu vereinbaren.", null],
  ["de", null, null],
  ["de", 42, null],
  ["de", "", null],
  ["de", "   ", null],
];

for (const [sprache, kandidat, erwartet] of ICH_FORMEN) {
  test(`ichFormOpeningLine(${JSON.stringify(kandidat)}, ${sprache}) -> ${JSON.stringify(erwartet)} (#3400)`, async () => {
    const { ichFormOpeningLine } = await import("../../src/elevenlabs/opening-line.ts");
    assert.equal(ichFormOpeningLine(kandidat, sprache), erwartet);
  });
}

test("Offenlegungs-Kern: eine Zeile mit dem Satzrest hinter dem Namen ist in jeder Sprache ungueltig (#3400)", async () => {
  const { disclosurePrefixFor } = await import("../../src/i18n/locales.ts");
  for (const sprache of SUPPORTED_LANGUAGES) {
    const praefix = disclosurePrefixFor(sprache);
    const kern = praefix.slice(praefix.indexOf(",") + 1).trim();
    assert.ok(kern.length > 0, sprache);
    assert.equal(validOpeningLine(`Hallo ${kern} danke.`), null, sprache);
  }
  assert.equal(validOpeningLine("Ich moechte einen Tisch reservieren."), "Ich moechte einen Tisch reservieren.");
});

const GESPEICHERT = [
  ["gueltig ohne Frage", () => gespeichertAm("Ich moechte einen Tisch reservieren."), "Ich moechte einen Tisch reservieren.", 0],
  ["gueltig mit Frage am Ende faellt auf die Bruecke", () => gespeichertAm("Haben Sie Zeit?"), TISCH_BRUECKE, 0],
  ["leere Zeile mit passendem Hash bleibt leer", () => gespeichertAm(""), "", 0],
  ["Hash passt nicht", () => gespeichertAm("Eine Zeile.", { openingLineSha256: openingLineHash("Andere.") }), TISCH_BRUECKE, 1],
  ["Hash fehlt", () => gespeichertAm("Eine Zeile.", { openingLineSha256: null }), TISCH_BRUECKE, 1],
  ["Zeile fehlt, Hash da", () => gespeichertAm("Eine Zeile.", { openingLine: undefined }), TISCH_BRUECKE, 1],
  ["Zeile keine Zeichenkette", () => gespeichertAm("Eine Zeile.", { openingLine: 5 }), TISCH_BRUECKE, 1],
  ["Alt-Datensatz ohne beides", () => ({ id: "call_y", goal: TISCH_ZIEL }), TISCH_BRUECKE, 0],
  ["Alt-Datensatz mit null", () => ({ id: "call_y", goal: "x", openingLine: null, openingLineSha256: null }), "Ich rufe an, um x.", 0],
  ["ohne brauchbares Ziel", () => ({ id: "call_z", goal: 7 }), "Fallback-Anlass.", 0],
];

for (const [name, baueAnruf, erwartet, warnungen] of GESPEICHERT) {
  test(`verifiedOpeningLine: ${name} (#3400)`, () => {
    const call = baueAnruf();
    const { wert, zeilen } = mitAufgefangenerWarnung(() => verifiedOpeningLine({ call, locale: ZEILEN_LOCALE }));
    assert.equal(wert, erwartet);
    assert.equal(zeilen.length, warnungen);
    if (warnungen > 0) {
      assert.equal(
        zeilen[0],
        `[opening-line] veraendert call=${call.id} - gespeicherte Zeile passt nicht zum Annahme-Hash, deterministischer Rueckfall greift`,
      );
    }
  });
}

const BESITZER = [
  ["gueltig ohne Frage", () => gespeichertAm("Ich moechte einen Tisch reservieren."), "Ich moechte einen Tisch reservieren."],
  ["gueltig mit Frage bleibt wie gespeichert", () => gespeichertAm("Haben Sie Zeit?"), "Haben Sie Zeit?"],
  ["leere Zeile mit passendem Hash bleibt leer", () => gespeichertAm(""), ""],
  ["Hash passt nicht", () => gespeichertAm("Eine Zeile.", { openingLineSha256: openingLineHash("Andere.") }), `${TISCH_BRUECKE} Haben Sie kurz Zeit?`],
  ["ohne Zeile", () => ({ id: "call_z", goal: 7 }), "Fallback-Anlass. Haben Sie kurz Zeit?"],
];

for (const [name, baueAnruf, erwartet] of BESITZER) {
  test(`ownerOpeningLine: ${name} (#3400)`, async () => {
    const { ownerOpeningLine } = await import("../../src/elevenlabs/opening-line.ts");
    const call = baueAnruf();
    const { wert } = mitAufgefangenerWarnung(() => ownerOpeningLine({ call, locale: ZEILEN_LOCALE }));
    assert.equal(wert, erwartet);
  });
}

test("bridgedObjective und composedOpeningLine: Auftrag wird zur Zeile, die Frage bleibt am Ende (#3400)", async () => {
  const { bridgedObjective } = await import("../../src/elevenlabs/opening-line.ts");
  assert.equal(bridgedObjective("  einen   Tisch\n zu reservieren. ", ZEILEN_LOCALE), TISCH_BRUECKE);
  assert.equal(bridgedObjective("Haben Sie Zeit?", ZEILEN_LOCALE), null);
  assert.equal(bridgedObjective("...", ZEILEN_LOCALE), null);
  assert.equal(bridgedObjective("   ", ZEILEN_LOCALE), null);
  assert.equal(bridgedObjective(3, ZEILEN_LOCALE), null);
  assert.equal(composedOpeningLine("Ein Anlass.", ZEILEN_LOCALE), "Ein Anlass. Haben Sie kurz Zeit?");
  assert.equal(composedOpeningLine("Ein Anlass?", ZEILEN_LOCALE), "Ein Anlass?");
});
