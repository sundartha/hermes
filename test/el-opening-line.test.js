import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { tempDataDir, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

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
let localeFor, afterGreeting;
let SUPPORTED_LANGUAGES;
let usageFor;
let fetchOpeningLine, composedOpeningLine, validOpeningLine, verifiedOpeningLine;
let OPENING_LINE_MAX_CHARS, OPENING_QUESTION_MAX_CHARS;
let providerOpeningFor;
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
  store = await import("../src/store.js");
  ({ config } = await import("../src/config.js"));
  ({ localeFor, SUPPORTED_LANGUAGES, afterGreeting } = await import("../src/i18n/locales.js"));
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

test("GQ-E1-07: der GANZE gesprochene Satz, je Sprache", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const locale = localeFor(lang);
    const gesprochen = providerOpeningFor(lang).replace(OPENING_LINE_VARIABLE, afterGreeting(locale.openingReasonFallback));
    const kiSatz = locale.aiSentence(OWNER_NAME_VARIABLE);
    assert.equal(
      gesprochen.split(kiSatz).length - 1,
      1,
      `Sprache ${lang}: der KI-Satz steht genau einmal in der Eroeffnung ("${gesprochen}")`,
    );
    assert.ok(
      gesprochen.indexOf(kiSatz) > gesprochen.indexOf(afterGreeting(locale.openingReasonFallback)),
      `Sprache ${lang}: der Anlass steht vor dem KI-Satz`,
    );
    assert.ok(!gesprochen.includes("?"), `Sprache ${lang}: keine Schlussfrage ("${gesprochen}")`);
    assert.ok(!/[.!?]{2}/.test(gesprochen), `Sprache ${lang}: kein doppeltes Satzzeichen ("${gesprochen}")`);
    assert.ok(gesprochen.endsWith(locale.summaryNotice), `Sprache ${lang}: die Eroeffnung endet mit dem Zusammenfassungs-Hinweis`);
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
    const mitKiSatz = `${locale.openingReasonFallback.slice(0, -1)}, ${locale.aiSentence("Max")}`;
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

test("LOCALES.en.aiSentence: der englische KI-Satz ist nicht leer und nennt den Auftraggeber (#3488)", () => {
  const satz = localeFor("en").aiSentence("Max Mustermann");
  assert.ok(satz.length > 0, satz);
  assert.ok(satz.includes("Max Mustermann"), satz);
});
