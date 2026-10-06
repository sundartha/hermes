import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LOCALES } from "../src/i18n/locales.js";
import { providerOpeningFor, providerVoicemailMessage } from "../src/elevenlabs/call-locale.js";

const TEMPLATE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";
const BEFUNDE_REL = "tasks/EL-STIMME-BEFUNDE.md";
const LANGS = Object.keys(LOCALES);

const B1_RULE =
  "Deliver content exactly once. When you start an answer, a story or a result, " +
  "the very next sentence is that answer, story or result - never a second introduction " +
  "of it. You announce an action only while a tool call or a wait is actually happening; " +
  "once you are speaking content, speak the content.";
const B2_RULE =
  "Convey mood through word choice and pacing only, never through notation of any kind.";
const OVERRIDE_NEU =
  "Generate a short, natural acknowledgement (max. 6-8 words) that you are working on the " +
  "answer. Do not name, introduce or announce the content - the full answer follows " +
  "immediately after. Never write anything in square brackets: every character you " +
  "produce is spoken out loud exactly as it stands.";

const SPEECH_B1 = Object.freeze({
  de: "Kündige Inhalt genau einmal an und liefere ihn dann: Der Satz nach einer Ankündigung IST der Inhalt, keine zweite Ankündigung. Eine Handlung kündigst du nur an, solange wirklich gewartet wird oder ein Werkzeug läuft.",
  en: "Announce content exactly once, then deliver it: the sentence after an announcement IS the content, never a second announcement. You announce an action only while genuinely waiting or while a tool is running.",
  fr: "Annonce le contenu une seule fois, puis livre-le : la phrase qui suit une annonce EST le contenu, jamais une deuxième annonce. Tu n'annonces une action que pendant une vraie attente ou pendant qu'un outil tourne.",
});
const SPEECH_B2 = Object.freeze({
  de: "Keine eckigen Klammern und keine Stimm- oder Regieanweisungen im Gesprochenen: Alles, was du schreibst, wird exakt so ausgesprochen. Stimmung trägst du nur über die Wortwahl.",
  en: "No square brackets and no mood or stage directions in spoken text: everything you write is pronounced exactly as it stands. Convey mood through word choice only.",
  fr: "Aucun crochet ni indication d'humeur ou de mise en scène dans le texte parlé : tout ce que tu écris est prononcé exactement tel quel. L'humeur passe uniquement par le choix des mots.",
});

const VOICEMAIL_PLATZHALTER = "{{voicemail_line}}";
const VOICEMAIL_OWNER = "Pin Testowner";
const VOICEMAIL_GRUNDZEILE = "Ich rufe wegen einer Terminfrage an.";

const BASE_LANGUAGE = "en";

const AENDERUNGSWEG_MARKER = "SOLL aendern NUR in dieser Vorlage";

const template = () =>
  JSON.parse(readFileSync(new URL(`../${TEMPLATE_REL}`, import.meta.url), "utf8"));

const masterPromptOf = (vorlage) => {
  const agentSection = vorlage.agent?.conversation_config?.agent ?? {};
  return agentSection.prompt?.prompt ?? "";
};
const softTimeoutConfig = (vorlage) => {
  const turn = vorlage.agent?.conversation_config?.turn ?? {};
  return turn.soft_timeout_config ?? {};
};
const softTimeoutOverrideOf = (vorlage) =>
  softTimeoutConfig(vorlage).llm_generated_message_prompt_override ?? null;
const besitzEintrag = (vorlage, feld) =>
  vorlage._besitz.felder.find((eintrag) => eintrag.feld === feld) ?? null;
const overrideKarte = (vorlage) =>
  vorlage.platform_settings?.overrides?.conversation_config_override ?? {};

const speechRulesOf = (lang) =>
  LOCALES[lang].prompt.speechRules({ loc: LOCALES[lang], settings: {} });

const presetFirstMessageOf = (preset) => {
  const override = preset?.overrides?.agent ?? {};
  return override.first_message ?? null;
};
const voicemailMessageOf = (agentSection) => {
  const builtInTools = agentSection.prompt?.built_in_tools ?? {};
  const detection = builtInTools.voicemail_detection ?? {};
  const params = detection.params ?? {};
  return params.voicemail_message ?? null;
};

const assertArt50FelderUnberuehrt = (vorlage) => {
  const conversationConfig = vorlage.agent.conversation_config;
  const agentSection = conversationConfig.agent;
  assert.equal(
    agentSection.first_message,
    providerOpeningFor(BASE_LANGUAGE),
    "first_message muss byte-identisch die aus LOCALES.en zusammengesetzte Eroeffnung bleiben",
  );
  const presets = conversationConfig.language_presets;
  for (const sprache of LANGS) {
    if (sprache === BASE_LANGUAGE) continue;
    assert.equal(
      presetFirstMessageOf(presets[sprache]),
      providerOpeningFor(sprache),
      `das Preset "${sprache}" muss die aus LOCALES.${sprache} zusammengesetzte Eroeffnung bleiben`,
    );
  }
  assert.equal(
    voicemailMessageOf(agentSection),
    VOICEMAIL_PLATZHALTER,
    "voicemail_message darf am Agenten KEINEN gesprochenen Text mehr tragen - alles, was hier " +
      "statisch steht, kommt bei jedem nicht-englischen Anruf englisch heraus",
  );
  for (const sprache of LANGS) {
    const text = providerVoicemailMessage({
      locale: LOCALES[sprache],
      ownerName: VOICEMAIL_OWNER,
      openingLine: VOICEMAIL_GRUNDZEILE,
    });
    assert.ok(
      text.startsWith(LOCALES[sprache].disclosure(VOICEMAIL_OWNER)),
      `der Anrufbeantworter-Text fuer "${sprache}" beginnt nicht mit LOCALES.${sprache}.disclosure`,
    );
    assert.ok(text.includes(VOICEMAIL_GRUNDZEILE), `"${sprache}": die Grund-Zeile fehlt`);
  }
  assert.equal(
    agentSection.disable_first_message_interruptions,
    true,
    "disable_first_message_interruptions muss true bleiben (dritte Art.-50-Stelle)",
  );
};

const bracketFree = (text) => !text.includes("[") && !text.includes("]");
const allNewRuleTexts = () => [
  B1_RULE,
  B2_RULE,
  OVERRIDE_NEU,
  ...LANGS.flatMap((lang) => [SPEECH_B1[lang], SPEECH_B2[lang]]),
];

const assertBesitzWertPin = (vorlage, feld, blatt) => {
  const eintrag = besitzEintrag(vorlage, feld);
  assert.ok(eintrag, `der Besitz-Eintrag "${feld}" fehlt in _besitz.felder`);
  assert.equal(eintrag.art, "wert", `"${feld}" muss art "wert" tragen (exakter Wertvergleich)`);
  assert.deepEqual(
    eintrag.vorlage,
    [`agent.conversation_config.turn.soft_timeout_config.${blatt}`],
    `"${feld}" muss genau den Vorlagen-Pfad auf ${blatt} vergleichen`,
  );
  assert.deepEqual(
    eintrag.live,
    [`conversation_config.turn.soft_timeout_config.${blatt}`],
    `"${feld}" muss genau den Live-Pfad auf ${blatt} vergleichen`,
  );
  assert.equal(
    eintrag.ausgenommen,
    undefined,
    `"${feld}" darf keine Ausnahme tragen - sonst waere die Bewachung stumm`,
  );
  assert.ok(
    eintrag._hinweis?.includes(AENDERUNGSWEG_MARKER),
    `"${feld}" muss den Aenderungsweg nennen (${AENDERUNGSWEG_MARKER})`,
  );
};

test("[abgenommen AS1] ST0-Forensik im Befund-Doc - Drift-Exit-Code, Abweichungsfelder und [el-tags]-Trefferzahl stehen als Zahlen", () => {
  const befunde = readFileSync(new URL(`../${BEFUNDE_REL}`, import.meta.url), "utf8");

  assert.match(
    befunde,
    /Exit-Code 1/,
    "der ST0-Driftlauf muss sein Ergebnis (Exit-Code 1) dokumentiert haben",
  );

  for (const feld of ["retention_days", "record_voice", "conversation_config_override"]) {
    assert.ok(befunde.includes(feld), `das Abweichungsfeld "${feld}" muss im Befund-Doc stehen`);
  }

  const treffer = befunde.match(/Trefferzahl[^\n]*?:\s*(\d+)/);
  assert.ok(
    treffer,
    "das Befund-Doc muss die [el-tags]-Trefferzahl als 'Trefferzahl ...: <Zahl>' nennen",
  );
  assert.ok(
    Number.parseInt(treffer[1], 10) >= 1,
    `die dokumentierte Trefferzahl muss >= 1 sein (steht da: ${treffer[1]})`,
  );
});

test("[abgenommen AS2] Vorlage traegt B1-Regel, B2-Ergaenzung und neuen soft_timeout-Override - und die Art-50-Felder bleiben unberuehrt", () => {
  const vorlage = template();

  assert.ok(
    masterPromptOf(vorlage).includes(B1_RULE),
    "der Master-Prompt der Vorlage traegt die B1-Regel (Deliver content exactly once ...)",
  );
  assert.ok(
    masterPromptOf(vorlage).includes(B2_RULE),
    "der Master-Prompt der Vorlage traegt die B2-Ergaenzung (Convey mood through word choice ...)",
  );

  assert.equal(
    softTimeoutOverrideOf(vorlage),
    OVERRIDE_NEU,
    "llm_generated_message_prompt_override muss exakt den neuen Wortlaut tragen (kein Ankündigen, kein Floskel-Verbot mehr)",
  );

  assertArt50FelderUnberuehrt(vorlage);
});

test("[abgenommen AS3] alle drei i18n-speechRules (de/en/fr) tragen die B1-Zeile UND die B2-Zeile", () => {
  for (const lang of LANGS) {
    const regeln = speechRulesOf(lang);
    assert.ok(
      regeln.includes(SPEECH_B1[lang]),
      `die speechRules (${lang}) traegt die B1-Zeile nicht - beide Wege (EL und Budget) muessen dieselbe Disziplin tragen`,
    );
    assert.ok(
      regeln.includes(SPEECH_B2[lang]),
      `die speechRules (${lang}) traegt die B2-Zeile nicht - beide Wege (EL und Budget) muessen dieselbe Disziplin tragen`,
    );
  }
});

test("[abgenommen AS4] keiner der neuen Regeltexte enthaelt ein eckiges Klammer-Zeichen", () => {
  const texte = allNewRuleTexts();

  for (const text of texte) {
    assert.ok(
      text.length > 0,
      "ein Kanon-Text der Wahrheits-Kette ist leer - der Pin misst dann nichts",
    );
  }
  assert.ok(
    texte.every(bracketFree),
    "mindestens ein Kanon-Text (Vorlage oder speechRules) enthaelt ein eckiges Klammer-Zeichen",
  );

  for (const lang of LANGS) {
    assert.ok(
      bracketFree(speechRulesOf(lang)),
      `der gerenderte speechRules-Block (${lang}) enthaelt ein eckiges Klammer-Zeichen`,
    );
  }
  assert.ok(
    bracketFree(softTimeoutOverrideOf(template())),
    "der soft_timeout-Override enthaelt ein eckiges Klammer-Zeichen",
  );
});

test("[abgenommen AS5] Vorlage pinnt die zwei Filler-Stellschrauben als Besitz (Feldname, beide Pfade, SOLL-Wert, Aenderungsweg) und fuehrt die zwei LIVE-only Erlaubnis-Schluessel mit false", () => {
  const vorlage = template();

  assertBesitzWertPin(vorlage, "soft_timeout_llm_filler", "use_llm_generated_message");
  assertBesitzWertPin(vorlage, "soft_timeout_filler_limit", "max_soft_timeouts_per_generation");

  assert.equal(
    softTimeoutConfig(vorlage).use_llm_generated_message,
    true,
    "use_llm_generated_message muss SOLL true tragen (LIVE-Messwert ST0/ST2)",
  );
  assert.equal(
    softTimeoutConfig(vorlage).max_soft_timeouts_per_generation,
    1,
    "max_soft_timeouts_per_generation muss SOLL 1 tragen (LIVE-Messwert ST2)",
  );

  assert.equal(
    overrideKarte(vorlage).tts.supported_voices,
    false,
    "tts.supported_voices muss false in der Erlaubnis-Karte stehen (keine Erweiterung)",
  );
  assert.equal(
    overrideKarte(vorlage).turn.soft_timeout_config.additional_soft_timeout_messages,
    false,
    "turn.soft_timeout_config.additional_soft_timeout_messages muss false in der Erlaubnis-Karte stehen (keine Erweiterung)",
  );
});

test("[abgenommen AS6] Drift-Lauf Exit-Code 0 nach dem Push als 'ST2 Push-Protokoll' im Befund-Doc dokumentiert", () => {
  const befunde = readFileSync(new URL(`../${BEFUNDE_REL}`, import.meta.url), "utf8");

  assert.match(
    befunde,
    /## ST2 Push-Protokoll/,
    "das Befund-Doc braucht einen Abschnitt '## ST2 Push-Protokoll' (entsteht mit dem Push)",
  );
  assert.ok(
    befunde.includes("Ruecklese"),
    "das Push-Protokoll muss die Ruecklese des Patches dokumentieren",
  );
  assert.ok(
    befunde.includes("Drift nach dem Push: Exit-Code 0"),
    "das Push-Protokoll muss 'Drift nach dem Push: Exit-Code 0' als Zeile tragen",
  );
});

test("ABNAHME-AS10: Verifikationsanruf im Befund-Doc belegt - Marken 0, B1 ungemeldet, Hoer-Urteil | ROT WEIL: der Verifikationsanruf wurde nicht durchgefuehrt - Owner-Entscheidung 2026-09-04: kein Testanruf, Kette trotzdem abschliessen | FIX: Testanruf gemaess Protokoll (tasks/EL-STIMME-BEFUNDE.md ST0-3, place_call auf die eigene Nummer) nachholen und Abschnitt '## ST4 Verifikationsanruf' mit call-/conv-ID, 'Klammer-Marken in Agent-Zeilen: 0', 'B1: ungemeldet', 'Hoer-Urteil' und anonymisierter Fixture dokumentieren", () => {
  const befunde = readFileSync(new URL(`../${BEFUNDE_REL}`, import.meta.url), "utf8");

  assert.match(
    befunde,
    /## ST4 Verifikationsanruf/,
    "das Befund-Doc braucht einen Abschnitt '## ST4 Verifikationsanruf' (entsteht mit dem Anruf)",
  );
  assert.ok(
    befunde.includes("Klammer-Marken in Agent-Zeilen: 0"),
    "der Verifikationsabschnitt muss 'Klammer-Marken in Agent-Zeilen: 0' als Zeile tragen",
  );
  assert.ok(
    befunde.includes("B1: ungemeldet"),
    "der Verifikationsabschluss muss 'B1: ungemeldet' festhalten",
  );
  assert.ok(
    befunde.includes("Hoer-Urteil"),
    "das Hoer-Urteil des Owners (Pre-Mortem R3/R6/R10) muss dokumentiert sein",
  );
});

test("[abgenommen AS11] lessons.md traegt die EL-Regel mit den VIER Kernsaetzen (Signatur-Phrasen)", () => {
  const lessons = readFileSync(new URL("../tasks/lessons.md", import.meta.url), "utf8");
  const signaturPhrasen = [
    "MELDEN, NICHT ENTFERNEN",
    "Beispiel schlaegt Regel",
    "Dashboard schlaegt ungepinntes Repo",
    "Vorlage ist kanonisch",
  ];

  for (const phrase of signaturPhrasen) {
    assert.ok(
      lessons.includes(phrase),
      `tasks/lessons.md muss die Signatur-Phrase '${phrase}' der EL-Regel enthalten`,
    );
  }
});
