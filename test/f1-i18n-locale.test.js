import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import {
  BOOTSTRAP_TENANT_ID,
  DEFAULT_LANGUAGE,
  setWorldDefaultLanguageEnabled,
} from "../src/store/defaults.js";
import { localeFor, LOCALES, SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";

const OWNER_NAME = "Jonas Beispiel";
const DE_DISCLOSURE =
  "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas Beispiel. Das Gespräch wird für meinen Auftraggeber zusammengefasst.";
const DE_SPEECH_CLAUSE = "Nur natürlich gesprochenes Deutsch.";
const DE_SUMMARY =
  'Du fasst ein Telefonat des KI-Assistenten von Jonas Beispiel zusammen. Antworte NUR mit validem JSON: {"summary": "2-3 Saetze auf Deutsch", "actionItems": ["..."], "objective_achieved": true|false|"unclear", "outcome": "1 Satz", "commitments": ["..."], "counterparty_commitments": ["..."], "open_points": ["..."], "next_step": "..."|null, "facts": ["..."]}. Nenne in der summary konkrete Ergebnisse (vereinbartes Datum/Uhrzeit, Preis, Name der Kontaktperson), sofern im Transkript vorhanden, statt allgemeiner Umschreibungen. objective_achieved bewertet AUSSCHLIESSLICH den unter "Auftrag" genannten urspruenglichen Auftrag (bei Inbound-Calls: ob das Anliegen des Anrufers geloest wurde). Vom Assistenten oder Angerufenen selbst eroeffnete Nebenthemen (z.B. ein angebotener oder abgebrochener Termin-Folgeschritt) sind fuer diese Bewertung IRRELEVANT. true = der Auftrag wurde genug beantwortet, auch wenn der Anruf mitten in einem Folgeschritt endete; false = der Auftrag wurde klar nicht erreicht; "unclear" = aus dem Auftrag heraus echt nicht beurteilbar. Action Items nur, wenn Jonas Beispiel wirklich etwas tun muss (max. 3). Bereits fest gebuchte Termine sind KEIN Action Item. Ergebnis-Karte: outcome ist EIN Satz mit dem konkreten Ergebnis (vereinbartes Datum/Uhrzeit, Preis, Name) oder - wenn nichts erreicht wurde - woran es lag. commitments sind Zusagen, die der Assistent im Namen von Jonas Beispiel gemacht hat; counterparty_commitments sind Zusagen der Gegenstelle. open_points sind Fragen, die offen blieben. next_step ist der EINE naechste Schritt fuer Jonas Beispiel, sonst null. facts sind dauerhaft nuetzliche Angaben ueber die Gegenstelle (Oeffnungszeiten, Ansprechpartner, Preise). Jede Liste hoechstens 3 Eintraege, jeder Eintrag hoechstens 200 Zeichen. Erfinde nichts: fehlt eine Angabe im Transkript, bleibt die Liste leer bzw. das Feld null.';

test("localeFor: bekannte Sprache liefert das passende Locale (de/fr/en)", () => {
  assert.equal(localeFor("de").language, "de");
  assert.equal(localeFor("fr").language, "fr");
  assert.equal(localeFor("en").language, "en");
});

test("Charakterisierung: localeFor faellt fail-safe auf DEFAULT_LANGUAGE zurueck (R7)", () => {
  assert.equal(localeFor("xx").language, DEFAULT_LANGUAGE);
  assert.equal(localeFor(undefined).language, DEFAULT_LANGUAGE);
  assert.equal(localeFor(null).language, DEFAULT_LANGUAGE);
  assert.equal(localeFor("").language, DEFAULT_LANGUAGE);
});

test("localeFor(null|undefined|'xx') liefert das EN-Locale (Weltdefault) (ex WORLD-03)", () => {
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
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.equal(typeof LOCALES[lang].voiceProfile, "string");
    assert.ok(LOCALES[lang].voiceProfile.length > 0, `voiceProfile fehlt fuer ${lang}`);
  }
});

test("VOICE-01 (Mechanismus, gruen) - Bundle fuer Sprachcode 'en' bleibt auf en-GB gepinnt (sttLocale+dateLocale)", () => {
  assert.equal(LOCALES.en.sttLocale, "en-GB");
  assert.equal(LOCALES.en.dateLocale, "en-GB");
});

test("Bundle: DE-Summary-Prompt ist byte-identisch zum Bestand; FR ist franzoesisch mit gleichen JSON-Keys", () => {
  assert.equal(LOCALES.de.summarySystem(OWNER_NAME), DE_SUMMARY);
  const fr = LOCALES.fr.summarySystem(OWNER_NAME);
  assert.ok(fr.includes("2-3 phrases en français"), `FR-Summary muss franzoesisch sein: ${fr}`);
  for (const key of [
    '"summary"',
    '"actionItems"',
    '"objective_achieved"',
    '"outcome"',
    '"commitments"',
    '"counterparty_commitments"',
    '"open_points"',
    '"next_step"',
    '"facts"',
  ]) {
    assert.ok(LOCALES.de.summarySystem(OWNER_NAME).includes(key), `DE-Key ${key} fehlt`);
    assert.ok(fr.includes(key), `FR-Key ${key} fehlt`);
  }
});

test("OUT-24 (Mechanismus, gruen) - EN-Offenlegungssatz ist byte-stabil und nicht abschaltbar", () => {
  const a = LOCALES.en.disclosure(OWNER_NAME);
  assert.equal(
    a,
    "Hello, this is an AI assistant calling on behalf of Jonas Beispiel. This conversation will be summarised for the person I represent.",
  );
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
  for (const key of [
    '"summary"',
    '"actionItems"',
    '"objective_achieved"',
    '"outcome"',
    '"commitments"',
    '"counterparty_commitments"',
    '"open_points"',
    '"next_step"',
    '"facts"',
  ]) {
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
  assert.equal(
    LOCALES.de.noSpeechRepromptAgain,
    "Ich höre Sie leider immer noch nicht. Sind Sie noch in der Leitung?",
  );
  assert.equal(
    LOCALES.de.noSpeechFarewell,
    "Ich kann Sie leider nicht hören. Ich versuche es später noch einmal. Auf Wiederhören.",
  );
  assert.equal(
    LOCALES.de.capFarewellSpeech,
    "Ich muss das Gespräch jetzt leider beenden. Vielen Dank für Ihre Zeit. Auf Wiederhören.",
  );
  assert.equal(
    LOCALES.de.budgetExhaustedHangup,
    "Das Demo-Budget ist aufgebraucht. Auf Wiederhören.",
  );
});

let systemPrompt, disclosureSentence, openingText;
before(async () => {
  const seed = seedState({
    calls: [],
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER_NAME }],
  });
  process.env.DATA_DIR = tempDataDir(seed);
  await import("../src/config.js");
  setWorldDefaultLanguageEnabled(true);
  ({ systemPrompt, disclosureSentence, openingText } = await import("../src/claude.js"));
});

const deCall = (over = {}) => seedCall({ tenantId: BOOTSTRAP_TENANT_ID, language: "de", ...over });
const frCall = (over = {}) => seedCall({ tenantId: BOOTSTRAP_TENANT_ID, language: "fr", ...over });
const enCall = (over = {}) => seedCall({ tenantId: BOOTSTRAP_TENANT_ID, language: "en", ...over });

test("DE-Wortlaut: disclosureSentence(de) == gepinnter Offenlegungssatz", () => {
  assert.equal(disclosureSentence(deCall()), DE_DISCLOSURE);
});

test("DE byte-identisch: systemPrompt(de) traegt die deutsche Output-Sprach-Regel", () => {
  const prompt = systemPrompt(deCall({ direction: "inbound" }));
  assert.ok(prompt.includes(DE_SPEECH_CLAUSE), `DE-Sprach-Regel fehlt: ${prompt}`);
});

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

test("PROMPT-18 (Mechanismus, gruen) - paralleler EN- und DE-Call faerben sich nicht gegenseitig ab", async () => {
  const [de, en] = await Promise.all([
    Promise.resolve(systemPrompt(deCall())),
    Promise.resolve(systemPrompt(enCall())),
  ]);
  assert.ok(de.includes(DE_SPEECH_CLAUSE));
  assert.ok(!de.includes(LOCALES.en.speechClause));
  assert.ok(en.includes(LOCALES.en.speechClause));
  assert.ok(!en.includes(DE_SPEECH_CLAUSE));
});

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
