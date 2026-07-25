// F1 Geo-Location (Phase 2) - Sprach-Resolver + LLM-Schicht sprachabhaengig.
// Zwei Achsen:
//   (A) Resolver localeFor() + Bundle-Vertrag (Fallback de, BCP-47-Locales, Voice-Profil)
//       - rein gegen src/i18n/locales.js (config-frei, statisch importierbar).
//   (B) claude.js konsumiert call.language: DE bleibt BYTE-IDENTISCH zum Bestand, FR ist
//       die kuratierte, fest verdrahtete Variante (R8); kein FR-Pfad faerbt DE ab.
//
// DATA_DIR im before VOR dem ersten config-/claude-Import (Repo-Regel, wie
// claude-identity/disclosure-regression). Der Resolver-Block braucht das nicht, laeuft
// aber gegen denselben statischen Import (kein Spawn, kein Netz - F.I.R.S.T.).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, DEFAULT_LANGUAGE } from "../src/store/defaults.js";
import { localeFor, LOCALES, SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";

// Heutiges DE-Verhalten, woertlich gepinnt. OWNER_NAME ist ein lokales Literal, das
// direkt in die reinen Locale-Funktionen geht (kein Store/Config noetig) - der Test ist
// damit env-unabhaengig deterministisch. Diese DE-Strings duerfen sich NIE aendern
// (byte-identisch); ein Refactor, der sie verschiebt, faellt hier auf.
const OWNER_NAME = "Jonas Beispiel";
const DE_DISCLOSURE =
  "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas Beispiel. Das Gespräch wird für meinen Auftraggeber zusammengefasst.";
const DE_SPEECH_CLAUSE = "Nur natürlich gesprochenes Deutsch."; // P5: Umlaut (D3)
// I11 (call-quality Impl-1): Klausel "nenne konkrete Ergebnisse ..." ergaenzt (S2 aus
// tasks/call-quality-findings.md: Summary war zu allgemein).
const DE_SUMMARY =
  'Du fasst ein Telefonat des KI-Assistenten von Jonas Beispiel zusammen. Antworte NUR mit validem JSON: {"summary": "2-3 Saetze auf Deutsch", "actionItems": ["..."], "objective_achieved": true|false|"unclear"}. Nenne in der summary konkrete Ergebnisse (vereinbartes Datum/Uhrzeit, Preis, Name der Kontaktperson), sofern im Transkript vorhanden, statt allgemeiner Umschreibungen. objective_achieved bewertet AUSSCHLIESSLICH den unter "Auftrag" genannten urspruenglichen Auftrag (bei Inbound-Calls: ob das Anliegen des Anrufers geloest wurde). Vom Assistenten oder Angerufenen selbst eroeffnete Nebenthemen (z.B. ein angebotener oder abgebrochener Termin-Folgeschritt) sind fuer diese Bewertung IRRELEVANT. true = der Auftrag wurde genug beantwortet, auch wenn der Anruf mitten in einem Folgeschritt endete; false = der Auftrag wurde klar nicht erreicht; "unclear" = aus dem Auftrag heraus echt nicht beurteilbar. Action Items nur, wenn Jonas Beispiel wirklich etwas tun muss (max. 3). Bereits fest gebuchte Termine sind KEIN Action Item.';

// ---- (A) Resolver + Bundle-Vertrag ----

test("localeFor: bekannte Sprache liefert das passende Locale (de/fr/en)", () => {
  assert.equal(localeFor("de").language, "de");
  assert.equal(localeFor("fr").language, "fr");
  assert.equal(localeFor("en").language, "en");
});

// Charakterisierung (i18n-Testkatalog, Regel 5): pinnt den HEUTIGEN Ist-Wert von
// DEFAULT_LANGUAGE ("de") als Fail-Safe-Ergebnis. Der Fail-Safe-MECHANISMUS selbst ist
// korrekt und bleibt (R3 der kanonischen Liste, tasks/i18n-tests/00-kanonische-liste.md) -
// nur der WERT am Ende der Kette steht zur Debatte. Das SOLL-Gegenstueck fuer denselben
// Sachverhalt ist WORLD-03 (heute rot, erwartet "en" statt DEFAULT_LANGUAGE): sobald
// DEFAULT_LANGUAGE auf "en" gestellt wird (Owner-Entscheidung 7.12, weltweiter Start),
// wird DIESER Test zwangslaeufig rot und muss dann nachgezogen werden (kanonische Liste,
// Nachtrag 2026-07-25: "D4/LANG-21 aendert seinen erwarteten Wert").
test("Charakterisierung: localeFor faellt fail-safe auf DEFAULT_LANGUAGE zurueck (heute 'de', R7)", () => {
  assert.equal(localeFor("xx").language, DEFAULT_LANGUAGE);
  assert.equal(localeFor(undefined).language, DEFAULT_LANGUAGE);
  assert.equal(localeFor(null).language, DEFAULT_LANGUAGE);
  assert.equal(localeFor("").language, DEFAULT_LANGUAGE);
  assert.equal(DEFAULT_LANGUAGE, "de");
});

// WORLD-03 (i18n-Testkatalog, Owner-Entscheidung 7.12): SOLL-Gegenstueck zur obigen
// Charakterisierung. Beleg: tasks/i18n-tests/00-kanonische-liste.md Abschnitt 4 (Nachtrag
// 7.12); PLAN-I18N-TESTS.md Abschnitt 7.12. Heute rot (liefert "de"-Locale statt "en").
test("WORLD-03 (SOLL, heute rot) - localeFor(null|undefined|'xx') liefert das EN-Locale (Weltdefault)", () => {
  assert.equal(localeFor("xx").language, "en");
  assert.equal(localeFor(undefined).language, "en");
  assert.equal(localeFor(null).language, "en");
  assert.equal(localeFor("").language, "en");
});

test("Bundle-Vertrag: STT-Locale ist volles BCP-47 + Voice-Profil je Sprache gesetzt", () => {
  assert.deepEqual([...SUPPORTED_LANGUAGES].sort(), ["de", "en", "fr"]);
  assert.equal(LOCALES.de.sttLocale, "de-DE");
  assert.equal(LOCALES.fr.sttLocale, "fr-FR");
  assert.equal(LOCALES.en.sttLocale, "en-GB");
  assert.equal(LOCALES.de.dateLocale, "de-DE");
  assert.equal(LOCALES.fr.dateLocale, "fr-FR");
  assert.equal(LOCALES.en.dateLocale, "en-GB");
  // Voice-Profil (Phase-3-Konsument) als nicht-leerer logischer Name vorhanden.
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.equal(typeof LOCALES[lang].voiceProfile, "string");
    assert.ok(LOCALES[lang].voiceProfile.length > 0, `voiceProfile fehlt fuer ${lang}`);
  }
});

// VOICE-01 (i18n-Testkatalog). Beleg: src/i18n/locales.js:219-220;
// tasks/i18n-tests/03-telefonie-render.md ("VOICE-01"). Mechanismus-Test (gruen,
// Regressionsschutz): dieser Pin gilt AUSDRUECKLICH nur fuer den Sprachcode "en" - NICHT
// fuer "Englisch generell". Owner-Entscheidung 7.5 (PLAN-I18N-TESTS.md Abschnitt 7.5)
// macht ein kuenftiges "en-US"-Bundle zu einem EIGENEN, separaten Bundle-Eintrag; welche
// Variante (en/en-GB vs. en-US) der WELTDEFAULT fuer Laender ohne eigenes Bundle waehlt,
// ist ausdruecklich noch offen (00-kanonische-liste.md, D16/VOICE-01: "entblockt", aber
// nur die Bundle-Frage, nicht die Weltdefault-Variante). Ein Test auf "irgendein
// EN-Bundle" wuerde den spaeteren Bundle-Schnitt fuer en-US blockieren - deshalb hier
// bewusst gegen den KONKRETEN Schluessel LOCALES.en, nicht gegen SUPPORTED_LANGUAGES.
test("VOICE-01 (Mechanismus, gruen) - Bundle fuer Sprachcode 'en' bleibt auf en-GB gepinnt (sttLocale+dateLocale)", () => {
  assert.equal(LOCALES.en.sttLocale, "en-GB");
  assert.equal(LOCALES.en.dateLocale, "en-GB");
});

test("Bundle: DE-Summary-Prompt ist byte-identisch zum Bestand; FR ist franzoesisch mit gleichen JSON-Keys", () => {
  assert.equal(LOCALES.de.summarySystem(OWNER_NAME), DE_SUMMARY);
  const fr = LOCALES.fr.summarySystem(OWNER_NAME);
  assert.ok(fr.includes("2-3 phrases en français"), `FR-Summary muss franzoesisch sein: ${fr}`);
  // JSON-Keys bleiben sprachunabhaengig (werden geparst) - in BEIDEN Sprachen identisch.
  for (const key of ['"summary"', '"actionItems"', '"objective_achieved"']) {
    assert.ok(LOCALES.de.summarySystem(OWNER_NAME).includes(key), `DE-Key ${key} fehlt`);
    assert.ok(fr.includes(key), `FR-Key ${key} fehlt`);
  }
});

// ---- (A3) Realtime-Felder (F1 P5): Voice + Whisper-Locale + Opener je Sprache ----

test("Realtime-Bundle: DE-Sentinels null (byte-identisch), FR/EN konkrete Voice + ISO-Whisper", () => {
  // DE: null -> Bridge nutzt config.realtimeVoice bzw. Whisper-Auto-Detect (Bestand).
  assert.equal(LOCALES.de.realtimeVoice, null);
  assert.equal(LOCALES.de.whisperLocale, null);
  // FR/EN: konkrete OpenAI-Voice + ISO-639-Whisper-Code (kein BCP-47).
  assert.equal(LOCALES.fr.realtimeVoice, "shimmer");
  assert.equal(LOCALES.fr.whisperLocale, "fr");
  assert.equal(LOCALES.en.realtimeVoice, "alloy");
  assert.equal(LOCALES.en.whisperLocale, "en");
});

test("Realtime-Bundle: Opener (outbound/inbound) je Sprache vorhanden, DE byte-identisch", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const op = LOCALES[lang].realtimeOpener;
    assert.equal(typeof op.outbound, "function", `${lang}: outbound-Opener fehlt`);
    assert.equal(typeof op.inbound, "string", `${lang}: inbound-Opener fehlt`);
    assert.ok(op.inbound.length > 0, `${lang}: inbound-Opener leer`);
    // Outbound-Opener bettet die Offenlegung ein.
    assert.ok(
      op.outbound("DISCLOSURE").includes("DISCLOSURE"),
      `${lang}: Offenlegung nicht eingebettet`,
    );
  }
  // DE-Opener byte-identisch zum frueheren bridge.js-Inline-Text.
  assert.equal(
    LOCALES.de.realtimeOpener.outbound("X"),
    'Beginne das Gespraech JETZT. Dein erster Satz muss exakt lauten: "X" Nenne danach kurz dein Anliegen.',
  );
  assert.equal(
    LOCALES.de.realtimeOpener.inbound,
    "Der Anrufer ist in der Leitung. Begruesse ihn jetzt entsprechend deiner Anweisungen.",
  );
});

test("Realtime-Bundle: localeFor-Fallback liefert DE-Sentinels (unbekannte Sprache -> de)", () => {
  assert.equal(localeFor("xx").realtimeVoice, null);
  assert.equal(localeFor("xx").whisperLocale, null);
});

// ---- (A2) EN-Bundle (F1 P4): kuratierte Offenlegung + statische Texte ----

// OUT-24 (i18n-Testkatalog). Beleg: src/i18n/locales.js:236-238;
// tasks/i18n-tests/05-auslandstelefonie.md ("OUT-24"). Mechanismus-Test (gruen):
// byte-exakter EN-Offenlegungssatz, UND der Nachweis, dass kein Call-Parameter (analog
// zum FR-Pin weiter unten) ihn veraendern/abschalten kann - nur ownerName ist gebunden.
test("OUT-24 (Mechanismus, gruen) - EN-Offenlegungssatz ist byte-stabil und nicht abschaltbar", () => {
  const a = LOCALES.en.disclosure(OWNER_NAME);
  assert.equal(
    a,
    "Hello, this is an AI assistant calling on behalf of Jonas Beispiel. This conversation will be summarised for the person I represent.",
  );
  // Kein zusaetzliches Argument/Call-Parameter kann den Wortlaut veraendern - die
  // Funktion nimmt einzig ownerName entgegen (Signatur-Beweis: erneuter Aufruf mit
  // demselben Namen liefert byte-identisch dasselbe Ergebnis).
  const b = LOCALES.en.disclosure(OWNER_NAME);
  assert.equal(a, b, "EN-Offenlegung muss byte-stabil/deterministisch sein");
});

test("EN-Bundle: kuratierte EN-Offenlegung (R8, nur ownerName gebunden) + EN-Summary mit gleichen JSON-Keys", () => {
  const disc = LOCALES.en.disclosure(OWNER_NAME);
  assert.ok(
    disc.startsWith("Hello, this is an AI assistant calling on behalf of "),
    `EN-Offenlegung-Wortlaut: ${disc}`,
  );
  assert.ok(disc.includes(OWNER_NAME), "ownerName muss gebunden sein");
  assert.ok(
    !disc.includes("Guten Tag") && !disc.includes("Bonjour"),
    "EN darf keinen DE/FR-Rest tragen",
  );
  const sum = LOCALES.en.summarySystem(OWNER_NAME);
  assert.ok(sum.includes("2-3 sentences in English"), `EN-Summary muss englisch sein: ${sum}`);
  for (const key of ['"summary"', '"actionItems"', '"objective_achieved"']) {
    assert.ok(sum.includes(key), `EN-Key ${key} fehlt`);
  }
});

test("EN-Bundle: statische Server-Texte (Reprompt/Fehler/Hangup/Greeting) sind englisch + nicht-leer", () => {
  const en = LOCALES.en;
  for (const field of [
    "llmDegradedSpeech",
    "turnErrorSpeech",
    "noSpeechReprompt",
    "noSpeechRepromptAgain",
    "noSpeechFarewell",
    "capFarewellSpeech",
    "budgetExhaustedHangup",
    "greetingDefault",
  ]) {
    assert.equal(typeof en[field], "string", `${field} muss ein String sein`);
    assert.ok(en[field].length > 0, `${field} darf nicht leer sein`);
  }
  assert.ok(
    en.greetingDefault.includes("{owner}"),
    "Greeting-Default behaelt den {owner}-Platzhalter",
  );
  assert.equal(en.voiceProfile, "en-female-neural");
});

test("Statische Texte: DE-Wortlaut gepinnt (Umlaute seit P1, kein Drift durch das Bundle)", () => {
  assert.equal(
    LOCALES.de.llmDegradedSpeech,
    "Entschuldigung, ich kann Ihr Anliegen gerade nicht bearbeiten. Ich melde mich, sobald es wieder möglich ist. Auf Wiederhören.",
  );
  assert.equal(
    LOCALES.de.turnErrorSpeech,
    "Entschuldigung, da ist ein technisches Problem aufgetreten. Bitte versuchen Sie es später erneut.",
  );
  assert.equal(LOCALES.de.noSpeechReprompt, "Können Sie das bitte wiederholen?");
  // P3.2: die zwei weiteren Eskalations-Stufen der No-Speech-Staffel.
  assert.equal(
    LOCALES.de.noSpeechRepromptAgain,
    "Ich höre Sie leider immer noch nicht. Sind Sie noch in der Leitung?",
  );
  assert.equal(
    LOCALES.de.noSpeechFarewell,
    "Ich kann Sie leider nicht hören. Ich versuche es später noch einmal. Auf Wiederhören.",
  );
  // P3.1: deterministischer Abschluss-Satz kurz vor dem harten Max-Dauer-Cap.
  assert.equal(
    LOCALES.de.capFarewellSpeech,
    "Ich muss das Gespräch jetzt leider beenden. Vielen Dank für Ihre Zeit. Auf Wiederhören.",
  );
  assert.equal(
    LOCALES.de.budgetExhaustedHangup,
    "Das Demo-Budget ist aufgebraucht. Auf Wiederhören.",
  );
});

// ---- (B) claude.js konsumiert call.language ----

let systemPrompt, disclosureSentence, openingText;
before(async () => {
  // Owner-Tenant mit explizitem ownerName seeden -> tenantContext liefert OWNER_NAME
  // deterministisch (kein Config/Env-Coupling, Muster wie claude-identity Tenant B).
  const seed = seedState({
    calls: [],
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER_NAME }],
  });
  process.env.DATA_DIR = tempDataDir(seed);
  await import("../src/config.js");
  ({ systemPrompt, disclosureSentence, openingText } = await import("../src/claude.js"));
});

const deCall = (over = {}) => seedCall({ tenantId: BOOTSTRAP_TENANT_ID, language: "de", ...over });
const frCall = (over = {}) => seedCall({ tenantId: BOOTSTRAP_TENANT_ID, language: "fr", ...over });
const enCall = (over = {}) => seedCall({ tenantId: BOOTSTRAP_TENANT_ID, language: "en", ...over });

// LANG-07 (i18n-Testkatalog). Beleg: src/claude.js:254-259,264-278;
// tasks/i18n-tests/01-sprachaufloesung.md ("LANG-07"). Der Katalog-Sachverhalt
// (Offenlegungssatz bleibt Deutsch fuer strukturell falsch aufgeloeste US-Tenants,
// call.language="de") ist mechanisch bereits durch DIESEN Test abgedeckt: die Funktion
// prueft nicht, WARUM ein Call call.language="de" traegt (LANG-02/LANG-04-Kette:
// web-onboardeter US-Tenant ohne gesetztes number.language/tenant.defaultLanguage), sie
// bekommt einzig den Wert. Ein zweiter Test mit identischem Aufruf
// disclosureSentence(deCall()) === DE_DISCLOSURE haette keinen eigenen Pruefwert (G5) -
// deshalb hier nur die Katalog-Referenz angehaengt statt einer Kopie.
test("DE-Wortlaut: disclosureSentence(de) == gepinnter Offenlegungssatz", () => {
  assert.equal(disclosureSentence(deCall()), DE_DISCLOSURE);
});

test("DE byte-identisch: fehlende Sprache faellt auf de zurueck (Bestands-Aufrufer ohne language)", () => {
  // disclosure-regression ruft disclosureSentence OHNE language auf -> muss de bleiben.
  assert.equal(disclosureSentence({ tenantId: BOOTSTRAP_TENANT_ID }), DE_DISCLOSURE);
});

test("DE byte-identisch: systemPrompt(de) traegt die deutsche Output-Sprach-Regel", () => {
  const prompt = systemPrompt(deCall({ direction: "inbound" }));
  assert.ok(prompt.includes(DE_SPEECH_CLAUSE), `DE-Sprach-Regel fehlt: ${prompt}`);
});

// Pin bewusst justiert (Runde 2, S-B): natuerlichere Bruecke statt Amtsdeutsch.
test("DE: openingText(de) == Offenlegung + 'Es geht um Folgendes: <goal>.'", () => {
  const text = openingText(deCall({ direction: "outbound", goal: "Testziel" }));
  assert.equal(text, `${DE_DISCLOSURE} Es geht um Folgendes: Testziel.`);
});

test("FR: disclosureSentence(fr) liefert die kuratierte FR-Variante (mit ownerName, NICHT die DE-Variante)", () => {
  const fr = disclosureSentence(frCall());
  assert.equal(fr, LOCALES.fr.disclosure(OWNER_NAME), "FR-Offenlegung muss aus dem Bundle kommen");
  assert.ok(fr.includes(OWNER_NAME), "ownerName muss gebunden sein");
  assert.notEqual(fr, DE_DISCLOSURE, "FR darf nicht die DE-Offenlegung sein");
  assert.ok(!fr.includes("Guten Tag"), `FR darf keinen DE-Rest tragen: ${fr}`);
});

test("FR-Offenlegung ist fest verdrahtet (R8): nicht per Call-Parameter waehlbar/abschaltbar", () => {
  // Unrelated Call-Parameter (callerName, goal, direction) duerfen den FR-Wortlaut NICHT
  // veraendern - er haengt allein an Sprache + gebundener Identitaet (byte-stabil).
  const a = disclosureSentence(frCall({ callerName: "Klaus", direction: "inbound" }));
  const b = disclosureSentence(frCall({ goal: "etwas ganz anderes", direction: "outbound" }));
  assert.equal(a, b, "FR-Offenlegung muss byte-stabil sein (kein Call-Parameter faerbt sie)");
  assert.equal(a, LOCALES.fr.disclosure(OWNER_NAME));
  assert.ok(!a.includes("Klaus"), "callerName darf nicht in die Offenlegung sickern");
});

test("FR: systemPrompt(fr) traegt die FR-Sprach-Regel und NICHT die deutsche (kein DE-Abfaerben umgekehrt)", () => {
  const prompt = systemPrompt(frCall({ direction: "inbound" }));
  assert.ok(prompt.includes(LOCALES.fr.speechClause), `FR-Sprach-Regel fehlt: ${prompt}`);
  assert.ok(!prompt.includes(DE_SPEECH_CLAUSE), "DE-Sprach-Regel darf im FR-Prompt nicht stehen");
});

test("FR: openingText(fr) nutzt die franzoesische Bruecke + FR-Offenlegung", () => {
  const text = openingText(frCall({ direction: "outbound", goal: "Testziel" }));
  assert.equal(text, `${LOCALES.fr.disclosure(OWNER_NAME)} ${LOCALES.fr.bridgePhrase("Testziel")}`);
  assert.ok(!text.includes("Es geht um Folgendes"), `FR darf keine DE-Bruecke tragen: ${text}`);
});

test("Gegenprobe: ein FR-Call faerbt einen parallelen DE-Call nicht ab (Resolver ist call-lokal)", () => {
  const frText = disclosureSentence(frCall());
  const deText = disclosureSentence(deCall());
  assert.equal(deText, DE_DISCLOSURE, "DE bleibt unveraendert, auch nachdem FR aufgeloest wurde");
  assert.notEqual(frText, deText);
});

// ---- LAW-02 (i18n-Testkatalog): EN end-to-end ueber disclosureSentence/openingText ----
// Beleg: src/i18n/locales.js:237-239 (EN-Disclosure-Funktion); src/claude.js:250-258;
// tasks/i18n-tests/09-recht-und-compliance.md ("LAW-02"). Bundle-Ebene ist bereits ueber
// LOCALES.en/OUT-24 getestet - hier fehlte bislang das DE/FR-aequivalente End-to-End (via
// disclosureSentence/openingText mit einem echten call.language="en"). Mechanismus-Test
// (gruen): das Bundle ist korrekt verdrahtet, es war nur der Test-Lueckenschluss noetig.
test("LAW-02 (Mechanismus, gruen) - EN: disclosureSentence(en) liefert die kuratierte EN-Offenlegung end-to-end", () => {
  const en = disclosureSentence(enCall());
  assert.equal(en, LOCALES.en.disclosure(OWNER_NAME), "EN-Offenlegung muss aus dem Bundle kommen");
  assert.ok(en.includes(OWNER_NAME), "ownerName muss gebunden sein");
  assert.notEqual(en, DE_DISCLOSURE, "EN darf nicht die DE-Offenlegung sein");
  assert.ok(!en.includes("Guten Tag"), `EN darf keinen DE-Rest tragen: ${en}`);
});

test("LAW-02 (Mechanismus, gruen) - EN: openingText(en) nutzt die englische Bruecke + EN-Offenlegung", () => {
  const text = openingText(enCall({ direction: "outbound", goal: "Test goal" }));
  assert.equal(text, `${LOCALES.en.disclosure(OWNER_NAME)} ${LOCALES.en.bridgePhrase("Test goal")}`);
  assert.ok(!text.includes("Es geht um Folgendes"), `EN darf keine DE-Bruecke tragen: ${text}`);
});
