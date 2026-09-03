// Abnahmekriterien AS1-AS4 der Stimme-Kette (ST1 aus tasks/PLAN-AGENTEN-STIMME.md, O1).
// ST2-ST4 erweitern dieselbe Datei um AS5-AS10 - die kommen MIT Abnahme-Kennung und
// Grund-Zeile in die ABNAHME-Bahn (npm run test:abnahme).
// ST2-Anteil (2026-09-03): AS5 pinnt die Vorlagen-Besitzerweiterung (Owner-Entscheidungen
// 4 + 9), ist GRUEN abgeliefert und direkt mitgewandert (ST1-Prezedenz); AS6 ist
// Doc-Kriterium und bleibt bewusst ROT bis zum dokumentierten Push - noch NICHT auswandern.
//
// MIGRATIONSSTAND: AS1-AS5 sind abgenommen (2026-09-03) und in den Regressionslauf
// gewandert - Kennung abgelegt, Siegel "[abgenommen <ID>]" getragen, Eintrag in
// test/abnahme-ausgewandert.json. Ab da haelt "npm test" sie fest (R2-Ratsche im
// Selbsttest der Abnahme-Bahn, test/abnahme-bahn-selbsttest.test.js). Die Grund-Zeile
// "| ROT WEIL: ... | FIX: ..." ist mit der Kennung weggefallen: R3 verlangt sie nur an
// Namen MIT Abnahme-Kennung, und ihr Inhalt dokumentierte den Zustand VOR ST1 - der ist
// jetzt eingepinnt, nicht mehr offen.
//
// WAHRHEITS-KETTE (O1, Wartungsregel): kanonisch fuer den Regel-Inhalt B1+B2 ist die
// EL-VORLAGE (elevenlabs/agent_configs/outbound-agent.template.json - Master-Prompt EN
// und soft_timeout-Override EN). Die speechRules-Zeilen in src/i18n/prompts/de.js, en.js
// und fr.js sind bewusste Uebersetzungen, keine zweite Wahrheit. Inhaltliche
// B1/B2-Aenderungen gehen im SELBEN Commit an allen FUENF Stellen und ihren Pins
// (AS2/AS3-Assertions) - wer nur eine Stelle aendert, macht AS2 oder AS3 rot.
//
// Testnamen tragen bewusst KEINE Katalog-ID des i18n-Launch-Testkatalogs am Namensanfang
// (package.json config.i18nCatalogPattern) und keine Abnahme-Kennung mehr, sondern das
// Abnahme-Siegel - sonst landet die Datei im falschen Testlauf (Lehre
// catalog-id-prefix-misroutes-tests).
//
// Kein Netz, kein Konto, kein DATA_DIR: geprueft werden die Vorlage im Repo, die
// LOCALES-Bausteine (config-frei, Bestandsmuster f1-i18n-locale / call-locale) und das
// Befund-Doc. Ob Vorlage und Live-Agent uebereinstimmen, ist Sache von
// npm run elevenlabs:drift (ST2).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LOCALES } from "../src/i18n/locales.js";
import { providerOpeningFor } from "../src/elevenlabs/call-locale.js";

const TEMPLATE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";
const BEFUNDE_REL = "tasks/EL-STIMME-BEFUNDE.md";
// EINE Aufzaehlung der Sprachmenge, aus LOCALES abgeleitet (keine zweite Liste, die
// driften kann) - auch die Preset-Schleife unten iteriert LANGS, nicht LOCALES selbst.
const LANGS = Object.keys(LOCALES);

// Kanon-Texte der Vorlage (Abschnitt 0 des ST1-Plans; Typografie im Bestandsstil der
// Vorlage: " - " statt Gedankenstrich, "Do not" statt "Do NOT").
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

// Uebersetzungen derselben Regel fuer die Budget-/Realtime-Prompts - je die GANZE neue
// Zeile ohne Bullet-Praefix, wie sie im gerenderten speechRules-Block steht.
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

// Statischer Text der Vorlage OHNE Gegenstueck in LOCALES (die Anrufbeantworter-Nachricht
// ist EL-spezifisch) - deshalb byte-Pin des Ist-Stands statt Zusammensetzung. Die
// Offenlegung darin ist LOCALES.en.disclosure woertlich vorangestellt (T5-Kette).
const VOICEMAIL_PIN =
  "Hello, this is an AI assistant calling on behalf of {{owner_name}}. This conversation " +
  "will be summarised for the person I represent. I am leaving this message because nobody " +
  "picked up. {{opening_line}} I will try again later. Goodbye.";

// Basis-Sprache des Agenten der Vorlage: ihr Satz steht in first_message, ein Preset fuer
// sie waere eine zweite Kopie desselben Wortlauts (Bestandsmuster EL-START T5 e).
const BASE_LANGUAGE = "en";

// Pin-Marker des Aenderungswegs an den ST2-Besitz-Eintraegen: der Satz ist bewusst
// identisch in beiden Eintraegen - er ist der R9-Riegel gegen Dashboard-Aenderungen am
// gepinnten SOLL (siehe _besitz.felder, Eintraege soft_timeout_llm_filler/_filler_limit).
const AENDERUNGSWEG_MARKER = "SOLL aendern NUR in dieser Vorlage";

const template = () =>
  JSON.parse(readFileSync(new URL(`../${TEMPLATE_REL}`, import.meta.url), "utf8"));

// In Stufen gelesen statt in einer Kette (G36/Demeter, Bestandsmuster el-prompt-kuerze).
const masterPromptOf = (vorlage) => {
  const agentSection = vorlage.agent?.conversation_config?.agent ?? {};
  return agentSection.prompt?.prompt ?? "";
};
// In Stufen gelesen statt in einer Kette (G36/Demeter, im Lint dieses Repos ein Fehler).
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

// Neutraler Render der speechRules: settings ohne agentStyle -> styleClause faellt auf
// die Neutral-Klausel, byte-stabil und ohne Store/Konfiguration.
const speechRulesOf = (lang) =>
  LOCALES[lang].prompt.speechRules({ loc: LOCALES[lang], settings: {} });

// In Stufen gelesen statt in einer Kette (G36/Demeter, im Lint dieses Repos ein Fehler).
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

// UNBERUEHRTHEIT der Art.-50-Felder (Pre-Mortem R1): eine Regel-Aenderung darf NIEMALS
// an ihnen mitschleifen. Dieselbe Kette wie EL-START T5 (c)/(e): first_message und die
// Presets sind die aus LOCALES zusammengesetzte Eroeffnung, der Schalter laesst den
// Satz zu Ende sprechen, der Anrufbeantworter-Text ist der gepinnte Ist-Stand.
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
    VOICEMAIL_PIN,
    "voicemail_message (zweite Art.-50-Stelle) muss byte-identisch bleiben - statischer Text, deshalb Ist-Pin",
  );
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

// EIN art-wert-Pin am soft_timeout_config (ST2, Owner-Entscheidung 4): Feldname, beide
// Pfade exakt, keine Ausnahme (eine Ausnahme wuerde die Bewachung stumm schalten) und der
// Aenderungsweg im Hinweis. Gemeinsamer Helfer fuer beide Eintraege - dieselbe Pruefung
// doppelt zu schreiben hiesse, sie getrennt pflegen zu koennen (G5).
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

  // Der gemessene Drift-Exit-Code steht als Zahl im Doc - nicht als "irgendwie rot".
  assert.match(
    befunde,
    /Exit-Code 1/,
    "der ST0-Driftlauf muss sein Ergebnis (Exit-Code 1) dokumentiert haben",
  );

  // Die Felder, die der Driftlauf als Abweichung meldet, stehen namentlich im Doc -
  // sonst ist die Zahl nicht zuordenbar.
  for (const feld of ["retention_days", "record_voice", "conversation_config_override"]) {
    assert.ok(befunde.includes(feld), `das Abweichungsfeld "${feld}" muss im Befund-Doc stehen`);
  }

  // Positivkontrolle gegen ein entleertes Messwerkzeug: die Trefferzahl steht als
  // geparste ZAHL da und ist >= 1 - ein leerer Rueckblick saehe hier wie "0 Treffer"
  // aus, wenn das Doc nur Behauptungen ohne Zahl enthielte.
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

  // (a)+(b) die Regeln stehen im Master-Prompt (Substring, nicht Ganz-Feld: der Prompt
  // traegt mehr als die Regeln).
  assert.ok(
    masterPromptOf(vorlage).includes(B1_RULE),
    "der Master-Prompt der Vorlage traegt die B1-Regel (Deliver content exactly once ...)",
  );
  assert.ok(
    masterPromptOf(vorlage).includes(B2_RULE),
    "der Master-Prompt der Vorlage traegt die B2-Ergaenzung (Convey mood through word choice ...)",
  );

  // (c) das Override-Feld ist GANZ ersetzt - exakte Gleichheit ist der staerkere Pin.
  assert.equal(
    softTimeoutOverrideOf(vorlage),
    OVERRIDE_NEU,
    "llm_generated_message_prompt_override muss exakt den neuen Wortlaut tragen (kein Ankündigen, kein Floskel-Verbot mehr)",
  );

  // (d) Unberuehrtheit der Art.-50-Felder - eigene Helfer-Funktion direkt darueber.
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
  // Lehre 18.08.: ein Prompt-Verbot mit Klammer-BEISPIEL verlor gegen das Beispiel -
  // deshalb darf KEIN neuer Regeltext auch nur ein "[" oder "]" enthalten.
  const texte = allNewRuleTexts();

  // Positivkontrolle gegen ein entleertes Messwerkzeug: alle Kanon-Texte sind besetzt,
  // sonst prueft bracketFree eine leere Menge und ist immer gruen.
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

  // Zusaetzlich die GERENDERTEN Bloecke (Lehre: Beispiel schlaegt Regel - gezaehlt wird,
  // was tatsaechlich im Prompt steht, nicht die Absicht) und der Override.
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

  // (a) beide Stellschrauben sind als Besitz gepinnt: Feldname, art, beide Pfade exakt,
  // keine Ausnahme, Aenderungsweg im Hinweis (der Pin-Marker fuer dieses Kriterium).
  assertBesitzWertPin(vorlage, "soft_timeout_llm_filler", "use_llm_generated_message");
  assertBesitzWertPin(vorlage, "soft_timeout_filler_limit", "max_soft_timeouts_per_generation");

  // (b) die SOLL-Werte sind der am Live-Agenten gemessene Stand (Bewachung, nicht
  // Korrektur) - SOLL == LIVE heisst: keine Schreib-Kandidaten, der spaetere ST2-Push
  // schreibt nur die ST1-Regelfelder.
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

  // (c) Entscheidung 9: die zwei LIVE-only Schluessel stehen mit false in der Karte -
  // Wert false heisst "nicht erlaubt", keine Erlaubnis wird erweitert (und die Karte
  // ist damit kein Push-Kandidat mehr, SOLL == LIVE).
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

test("ABNAHME-AS6: Drift-Lauf Exit-Code 0 nach dem Push als 'ST2 Push-Protokoll' im Befund-Doc dokumentiert | ROT WEIL: der Push ist nicht ausgefuehrt - ST2-Reposeite liefert bewusst nur das SOLL, der Push ist Owner-Gate | FIX: frischen Drift-Lauf, Push der ST1-Regelfelder mit Ruecklese, danach Drift-Exit-Code 0 als Abschnitt '## ST2 Push-Protokoll' (mit 'Ruecklese' und 'Drift nach dem Push: Exit-Code 0') in tasks/EL-STIMME-BEFUNDE.md dokumentieren", () => {
  const befunde = readFileSync(new URL(`../${BEFUNDE_REL}`, import.meta.url), "utf8");

  // Der Abschnitt entsteht erst mit dem echten Push - die Marker-Literale sind die
  // Vorgabe an den, der den Push protokolliert (Bestandsmuster AS1: String-Checks).
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
