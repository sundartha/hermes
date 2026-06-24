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
  "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas Beispiel. Das Gespraech wird fuer meinen Auftraggeber zusammengefasst.";
const DE_SPEECH_CLAUSE = "Nur natuerlich gesprochenes Deutsch.";
const DE_SUMMARY =
  'Du fasst ein Telefonat des KI-Assistenten von Jonas Beispiel zusammen. Antworte NUR mit validem JSON: {"summary": "2-3 Saetze auf Deutsch", "actionItems": ["..."], "objective_achieved": true|false|"unclear"}. objective_achieved bezieht sich auf den Auftrag (bei Inbound-Calls: ob das Anliegen des Anrufers geloest wurde). Action Items nur, wenn Jonas Beispiel wirklich etwas tun muss (max. 3). Bereits fest gebuchte Termine sind KEIN Action Item.';

// ---- (A) Resolver + Bundle-Vertrag ----

test("localeFor: bekannte Sprache liefert das passende Locale (de/fr/en)", () => {
  assert.equal(localeFor("de").language, "de");
  assert.equal(localeFor("fr").language, "fr");
  assert.equal(localeFor("en").language, "en");
});

test("localeFor: unbekannte/fehlende/null Sprache faellt fail-safe auf de (R7)", () => {
  assert.equal(localeFor("xx").language, DEFAULT_LANGUAGE);
  assert.equal(localeFor(undefined).language, DEFAULT_LANGUAGE);
  assert.equal(localeFor(null).language, DEFAULT_LANGUAGE);
  assert.equal(localeFor("").language, DEFAULT_LANGUAGE);
  assert.equal(DEFAULT_LANGUAGE, "de");
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

test("Statische Texte: DE byte-identisch zum frueheren server.js-Bestand (kein Drift durch das Bundle)", () => {
  assert.equal(
    LOCALES.de.llmDegradedSpeech,
    "Entschuldigung, ich kann Ihr Anliegen gerade nicht bearbeiten. Ich melde mich, sobald es wieder moeglich ist. Auf Wiederhoeren.",
  );
  assert.equal(
    LOCALES.de.turnErrorSpeech,
    "Entschuldigung, da ist ein technisches Problem aufgetreten. Bitte versuchen Sie es spaeter erneut.",
  );
  assert.equal(LOCALES.de.noSpeechReprompt, "Entschuldigung, koennen Sie das bitte wiederholen?");
  assert.equal(
    LOCALES.de.budgetExhaustedHangup,
    "Das Demo-Budget ist aufgebraucht. Auf Wiederhoeren.",
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

test("DE byte-identisch: disclosureSentence(de) == Bestands-Wortlaut", () => {
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

test("DE byte-identisch: openingText(de) == Offenlegung + 'Ich rufe an, weil <goal>.'", () => {
  const text = openingText(deCall({ direction: "outbound", goal: "Testziel" }));
  assert.equal(text, `${DE_DISCLOSURE} Ich rufe an, weil Testziel.`);
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
  assert.ok(!text.includes("Ich rufe an, weil"), `FR darf keine DE-Bruecke tragen: ${text}`);
});

test("Gegenprobe: ein FR-Call faerbt einen parallelen DE-Call nicht ab (Resolver ist call-lokal)", () => {
  const frText = disclosureSentence(frCall());
  const deText = disclosureSentence(deCall());
  assert.equal(deText, DE_DISCLOSURE, "DE bleibt unveraendert, auch nachdem FR aufgeloest wurde");
  assert.notEqual(frText, deText);
});
