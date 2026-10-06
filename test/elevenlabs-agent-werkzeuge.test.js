import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { config } from "../src/config.js";
import { consultAllowedFor } from "../src/consult/gate.js";
import { makeConfigOverrides } from "./helpers.js";

const CONSULT_TOOL = "get_consult";

const TEMPLATE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";
const TEMPLATE = JSON.parse(readFileSync(new URL(`../${TEMPLATE_REL}`, import.meta.url), "utf8"));

const DOC_KEY_PREFIX = "_";
const configKeysOf = (obj) =>
  Object.keys(obj ?? {})
    .filter((key) => !key.startsWith(DOC_KEY_PREFIX))
    .sort();

const conversationConfig = () => TEMPLATE.agent?.conversation_config ?? {};
const agentSection = () => conversationConfig().agent ?? {};
const promptObject = () => agentSection().prompt;
const promptText = () => promptObject()?.prompt ?? "";
const toolIds = () => promptObject()?.tool_ids;
const builtInTools = () => promptObject()?.built_in_tools;
const languageDetection = () => builtInTools()?.language_detection;
const languagePresets = () => conversationConfig().language_presets;
const declaredToolNames = () => configKeysOf(TEMPLATE.tools);
const toolEntry = (name) => TEMPLATE.tools?.[name] ?? {};

const TOOL_FINGERPRINT = ["get_consult", "look_up"];

const PROMPT_FIELD_FINGERPRINT = [
  "built_in_tools",
  "llm",
  "prompt",
  "reasoning_effort",
  "temperature",
  "timezone",
  "tool_ids",
];

const BUILT_IN_TOOL_FINGERPRINT = ["end_call", "language_detection", "voicemail_detection"];

const DEFERRED_BUILT_IN_TOOL = "play_keypad_touch_tone";

const LANGUAGE_PRESET_FINGERPRINT = ["de", "es", "fr"];

const DRIFT_HINT =
  "Das ist erlaubt - aber nur bewusst: Liste in test/elevenlabs-agent-werkzeuge.test.js " +
  "nachziehen UND im Buchhaltungs-Kommentar in einer Zeile begruenden, was dazu kam oder " +
  "wegfiel. Ein Werkzeug, das still auftaucht oder verschwindet, dreht Abnahmekriterien " +
  "gruen oder rot, ohne dass jemand es entschieden hat.";

test("Werkzeug-Inventar der ElevenLabs-Vorlage: exakt die gepinnte Menge, in beide Richtungen", () => {
  assert.ok(TOOL_FINGERPRINT.length > 0, "der Fingerprint ist besetzt - sonst misst er nichts");

  assert.deepEqual(
    declaredToolNames(),
    TOOL_FINGERPRINT,
    `Der Werkzeugbestand in ${TEMPLATE_REL} (tools) hat sich geaendert. ${DRIFT_HINT}`,
  );
});

test("Werkzeug-Inventar der ElevenLabs-Vorlage: die Konfigurationsflaeche des Prompts ist gepinnt", () => {
  assert.deepEqual(
    configKeysOf(promptObject()),
    PROMPT_FIELD_FINGERPRINT,
    `Das prompt-Objekt in ${TEMPLATE_REL} traegt andere Felder als gepinnt - ein Werkzeug ` +
      `kann auch ueber ein NEUES Feld an den Agenten kommen, ohne in tools aufzutauchen. ` +
      DRIFT_HINT,
  );
});

test("Werkzeug-Inventar der ElevenLabs-Vorlage: die eingebauten Werkzeuge sind exakt die gepinnte Menge", () => {
  assert.ok(
    BUILT_IN_TOOL_FINGERPRINT.length > 0,
    "der Fingerprint ist besetzt - sonst misst er nichts",
  );

  assert.deepEqual(
    configKeysOf(builtInTools()),
    BUILT_IN_TOOL_FINGERPRINT,
    `Die eingebauten Werkzeuge in ${TEMPLATE_REL} (prompt.built_in_tools) sind andere als ` +
      `gepinnt. ${DRIFT_HINT}`,
  );
});

test(`Werkzeug-Inventar der ElevenLabs-Vorlage: ${DEFERRED_BUILT_IN_TOOL} bleibt draussen - es liegt am LIVE-Agenten und wurde bewusst nicht uebernommen, weil kein Abnahmekriterium DTMF verlangt (Entscheidung zurueckgestellt, nicht vergessen)`, () => {
  const toolNamesEverywhere = [...declaredToolNames(), ...configKeysOf(builtInTools())];

  assert.ok(
    toolNamesEverywhere.includes(CONSULT_TOOL),
    "Messwerkzeug defekt: die tools-Karte der Vorlage wird nicht gelesen",
  );
  assert.ok(
    configKeysOf(builtInTools()).length > 0,
    "Messwerkzeug defekt: die eingebauten Werkzeuge der Vorlage werden nicht gelesen",
  );

  assert.ok(
    !toolNamesEverywhere.includes(DEFERRED_BUILT_IN_TOOL),
    `${TEMPLATE_REL} fuehrt wieder ${DEFERRED_BUILT_IN_TOOL}. Das Werkzeug lag beim Bau der ` +
      "Vorlage am Live-Agenten und wurde ABSICHTLICH nicht uebernommen: kein Abnahmekriterium " +
      `verlangt DTMF. ${DRIFT_HINT}`,
  );

  assert.ok(
    !BUILT_IN_TOOL_FINGERPRINT.includes(DEFERRED_BUILT_IN_TOOL),
    `Der Pin traegt ${DEFERRED_BUILT_IN_TOOL}. Die Aufnahme ist erlaubt - aber nur als eigene ` +
      "Entscheidung: erst das Kriterium benennen, das DTMF verlangt, dann diesen Fall hier " +
      "loeschen und die Buchhaltung am Pin um eine Zeile ergaenzen.",
  );
});

const CONSULT_BODY_SCHEMA_KEY = "request_body_schema";
const CONSULT_UNBELEGTER_SCHEMA_KEY = "body_params_schema";
const CONSULT_CONVERSATION_KEY = "conversation_id";
const CONSULT_SYSTEM_VARIABLE = "system__conversation_id";
const CONSULT_HANDLER_REL = "src/routes/webhooks-elevenlabs.js";

const consultApiSchema = () => toolEntry(CONSULT_TOOL).tool_config?.api_schema ?? {};

test("Werkzeug-Inventar der ElevenLabs-Vorlage: get_consult schickt die Gespraechskennung mit, die der Webhook liest", () => {
  const apiSchema = consultApiSchema();

  assert.equal(
    apiSchema[CONSULT_UNBELEGTER_SCHEMA_KEY],
    undefined,
    `${TEMPLATE_REL}: api_schema traegt wieder "${CONSULT_UNBELEGTER_SCHEMA_KEY}". Dieser Name steht in der OpenAPI-Spezifikation des Anbieters nirgends - was darunter deklariert wird, erreicht das Konto nie und faellt beim Push nicht auf.`,
  );

  const schema = apiSchema[CONSULT_BODY_SCHEMA_KEY];
  assert.equal(
    typeof schema,
    "object",
    `${TEMPLATE_REL}: api_schema.${CONSULT_BODY_SCHEMA_KEY} fehlt - dann deklariert das Werkzeug keinen einzigen Parameter und der Anbieter sendet einen leeren Koerper.`,
  );

  const kennung = schema.properties?.[CONSULT_CONVERSATION_KEY];
  assert.ok(
    kennung,
    `${TEMPLATE_REL}: der Parameter "${CONSULT_CONVERSATION_KEY}" fehlt in api_schema.${CONSULT_BODY_SCHEMA_KEY}.properties. ${CONSULT_HANDLER_REL} bindet die Rueckfrage ueber genau diesen Schluessel an den laufenden Anruf - ohne ihn antwortet der Server 404 kein_laufender_anruf, so am 18.08.2026 zweimal in einem echten Anruf gemessen.`,
  );

  assert.equal(
    kennung.dynamic_variable,
    CONSULT_SYSTEM_VARIABLE,
    `${TEMPLATE_REL}: "${CONSULT_CONVERSATION_KEY}" wird nicht aus ${CONSULT_SYSTEM_VARIABLE} gefuellt. Ohne dynamic_variable muesste das MODELL die Kennung liefern - es kennt sie nicht und wuerde sie erfinden.`,
  );

  assert.equal(
    kennung.description,
    undefined,
    `${TEMPLATE_REL}: "${CONSULT_CONVERSATION_KEY}" traegt description NEBEN dynamic_variable - das Anbieter-Schema nennt beide ausdruecklich gegenseitig ausschliessend.`,
  );

  const handlerQuelle = readFileSync(new URL(`../${CONSULT_HANDLER_REL}`, import.meta.url), "utf8");
  assert.ok(
    handlerQuelle.includes(CONSULT_CONVERSATION_KEY),
    `${CONSULT_HANDLER_REL} nennt "${CONSULT_CONVERSATION_KEY}" nicht mehr. Sende- und Leseseite tragen dann verschiedene Namen, und die Rueckfrage landet wieder bei 404 - der Schluessel ist der einzige Draht zwischen beiden.`,
  );
});

const TENANT_TOKEN_KEY = "tenant_token";
const TENANT_TOKEN_VARIABLE = "tenant_token";

test("Werkzeug-Inventar der ElevenLabs-Vorlage: beide Werkzeuge schicken die Mandanten-Dimension mit, die der Webhook prueft (SEC-P4)", () => {
  for (const werkzeug of declaredToolNames()) {
    const schema = toolEntry(werkzeug).tool_config?.api_schema?.[CONSULT_BODY_SCHEMA_KEY];
    const parameter = schema?.properties?.[TENANT_TOKEN_KEY];
    assert.ok(
      parameter,
      `${TEMPLATE_REL}: Werkzeug "${werkzeug}" deklariert "${TENANT_TOKEN_KEY}" nicht. Der Aufruf traegt dann keine Mandanten-Dimension, und das eine geteilte Geheimnis erreicht wieder jeden laufenden Anruf jedes Mandanten.`,
    );
    assert.equal(
      parameter.dynamic_variable,
      TENANT_TOKEN_VARIABLE,
      `${TEMPLATE_REL}: "${TENANT_TOKEN_KEY}" an "${werkzeug}" wird nicht aus der dynamischen Variablen ${TENANT_TOKEN_VARIABLE} gefuellt - ohne dynamic_variable muesste das MODELL den Wert liefern, es kennt ihn nicht.`,
    );
    assert.equal(
      parameter.description,
      undefined,
      `${TEMPLATE_REL}: "${TENANT_TOKEN_KEY}" an "${werkzeug}" traegt description NEBEN dynamic_variable - das Anbieter-Schema nennt beide ausdruecklich gegenseitig ausschliessend.`,
    );
    assert.ok(
      !(schema.required ?? []).includes(TENANT_TOKEN_KEY),
      `${TEMPLATE_REL}: "${TENANT_TOKEN_KEY}" steht an "${werkzeug}" unter required - ein Anruf, der VOR dem Push gestartet wurde, traegt den Wert nicht, und ein dynamic_variable-Parameter wird nie vom Modell geliefert.`,
    );
  }

  const handlerQuelle = readFileSync(new URL(`../${CONSULT_HANDLER_REL}`, import.meta.url), "utf8");
  assert.ok(
    handlerQuelle.includes(TENANT_TOKEN_KEY),
    `${CONSULT_HANDLER_REL} nennt "${TENANT_TOKEN_KEY}" nicht mehr. Sende- und Leseseite tragen dann verschiedene Namen, und der Riegel prueft einen Wert, den niemand schickt.`,
  );
});

test("Werkzeug-Inventar der ElevenLabs-Vorlage: jedes Werkzeug heisst ueberall gleich und haengt genau einmal am Agenten", () => {
  for (const name of declaredToolNames()) {
    assert.equal(
      toolEntry(name).tool_config?.name,
      name,
      `Werkzeug "${name}": Karten-Schluessel und tool_config.name laufen auseinander - ` +
        "hochgeladen wird der Wert aus tool_config, gepinnt wird der Schluessel.",
    );
  }

  const ids = toolIds();
  assert.ok(Array.isArray(ids), `${TEMPLATE_REL}: prompt.tool_ids ist eine Liste`);
  assert.equal(
    ids.length,
    declaredToolNames().length,
    "Jedes deklarierte Werkzeug haengt genau einmal am Agenten. Mehr Kennungen als " +
      `Werkzeuge heisst: der Agent traegt etwas, das die Vorlage nicht deklariert. ${DRIFT_HINT}`,
  );

  for (const entry of ids.filter((id) => String(id).includes("AUSFUELLEN"))) {
    assert.ok(
      declaredToolNames().some((name) => String(entry).includes(name)),
      `Die Platzhalter-Kennung "${entry}" nennt kein deklariertes Werkzeug.`,
    );
  }
});

const ONLY_AT_START_KEY = "only_at_conversation_start";
const onlyAtStartAnywhere = (node) => {
  if (node === null || typeof node !== "object") return false;
  if (node[ONLY_AT_START_KEY] === true) return true;
  return Object.values(node).some((child) => onlyAtStartAnywhere(child));
};

const LOCK_SENTENCE = "Speak only in this language";

const sentencesOf = (text) =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
const anySentenceMatchesAll = (text, concepts) =>
  sentencesOf(text).some((sentence) => concepts.every((concept) => concept.test(sentence)));

const SWITCH_VERB = /\b(switch|change|move|shift)\w*/i;
const FOLLOW_VERB = /\b(continue|keep|carry on|follow|proceed|stay)\w*/i;
const NEGATION = /\b(do not|don't|never|must not|cannot|can't|avoid|refrain)\b/i;
const LANGUAGE_WORD = /\blanguage/i;
const ENGLISH = /\benglish\b/i;
const CONFIRM = /\bconfirm\w*/i;
const UNKLARER_ANLASS = /\b(single word|one word|isolated word|fragment|unclear|ambiguous)\w*/i;
const ERSTER_ZUG = /\b(opening|first|initial)\b/i;
const AEUSSERUNG = /\b(message|line|greeting|sentence|words)\b/i;

const REQUIRED_LANGUAGE_RULES = Object.freeze([
  {
    label: "(a) die Startsprache ist die Sprache der Eroeffnung und bleibt es",
    concepts: [ERSTER_ZUG, AEUSSERUNG, LANGUAGE_WORD],
  },
  {
    label: "(b) gewechselt wird erst nach einer Bestaetigung",
    concepts: [SWITCH_VERB, CONFIRM],
  },
  {
    label: "(c) ein einzelnes Wort, ein Fragment oder Unklares ist kein Wechselgrund",
    concepts: [UNKLARER_ANLASS, NEGATION, SWITCH_VERB],
  },
  {
    label: "(d) das Ziel bleibt dabei unveraendert dasselbe",
    concepts: [/\b(same|unchanged|identical)\b/i, /\b(objective|goal|task|purpose|mission)\w*/i],
  },
]);

const FORBIDDEN_LANGUAGE_RULES = Object.freeze([
  {
    label: "Sprach-Sperre (nur eine Sprache erlaubt)",
    concepts: [/\b(only|exclusively|solely)\b/i, LANGUAGE_WORD],
    entkraeftet: [CONFIRM],
    why: "ein Prompt, der auf eine Sprache festnagelt, arbeitet gegen language_detection",
  },
  {
    label: "Wechsel-Verbot ohne Bestaetigungsweg",
    concepts: [NEGATION, SWITCH_VERB, LANGUAGE_WORD],
    entkraeftet: [UNKLARER_ANLASS],
    why: "derselbe Widerspruch, nur negativ formuliert - erlaubt ist nur das enge Verbot fuer Wort/Fragment/Unklares",
  },
  {
    label: "Rueckwechsel-Pflicht",
    concepts: [/\b(back|return|revert)\w*/i, ENGLISH],
    entkraeftet: [],
    why: "vom Eigentuemer ausdruecklich benannt: derselbe Fehler in gruen",
  },
  {
    label: "bedingungsloses Mitgehen (die alte E-5-Regel)",
    concepts: [SWITCH_VERB, FOLLOW_VERB, LANGUAGE_WORD],
    entkraeftet: [CONFIRM],
    why: "genau diese Regel hat am 2026-09-04 einen Phantom-Zug in ein spanisches Gespraech verwandelt - ein einziger Fehlhoerer genuegte",
  },
]);

const anySentenceIsForbidden = (text, rule) =>
  sentencesOf(text).some(
    (sentence) =>
      rule.concepts.every((concept) => concept.test(sentence)) &&
      !rule.entkraeftet.some((ausnahme) => ausnahme.test(sentence)),
  );

const CONTROL_OK =
  "Use the language of your first greeting and stay in it for the entire call. " +
  "If they seem to be using another language, ask once, short and in both languages, " +
  "whether they would rather use it; change over only once they have confirmed in that " +
  "language, and stay on the same objective. " +
  "One isolated word, a fragment or anything unclear must never make you change the " +
  "language or remark on the line quality; just repeat your last question.";
const CONTROL_VIOLATIONS = Object.freeze([
  "Speak only in this language: {{language}}.",
  "Never switch the language during the call.",
  "If they switch, follow them, but return to English right after.",
  "If the other party switches to another language, continue in that language.",
  "Never switch the language, even if they confirm.",
]);

test("Sprachwechsel in der ElevenLabs-Vorlage: language_detection gilt den ganzen Anruf, nicht nur zum Start", () => {
  const detection = languageDetection();
  assert.ok(
    detection !== null && typeof detection === "object",
    `${TEMPLATE_REL}: prompt.built_in_tools.language_detection traegt eine Konfiguration - ` +
      "ohne das Werkzeug erkennt niemand, dass die Gegenseite die Sprache gewechselt hat.",
  );

  assert.equal(
    onlyAtStartAnywhere(detection),
    false,
    `${TEMPLATE_REL}: ${ONLY_AT_START_KEY} steht unter language_detection auf true - dann ` +
      "erkennt das Werkzeug den Wechsel nur beim Gespraechsstart, waehrend der Prompt ihn " +
      "fuer den ganzen Anruf freigibt. Genau der Widerspruch, den E-5 aufgeloest hat.",
  );
});

test("Sprachwechsel in der ElevenLabs-Vorlage: language_presets traegt exakt die gepinnten Sprachen", () => {
  assert.ok(
    LANGUAGE_PRESET_FINGERPRINT.length > 0,
    "der Fingerprint ist besetzt - sonst misst er nichts",
  );

  assert.deepEqual(
    configKeysOf(languagePresets()),
    LANGUAGE_PRESET_FINGERPRINT,
    `Die Zusatzsprachen in ${TEMPLATE_REL} (conversation_config.language_presets) sind andere ` +
      `als gepinnt. Eine Sprache, die der Agent kann oder nicht kann, ist eine Faehigkeit - ` +
      DRIFT_HINT,
  );
});

test("Sprachwechsel in der ElevenLabs-Vorlage: der Prompt haelt die Startsprache und gibt den Wechsel erst nach Bestaetigung frei", () => {
  for (const rule of REQUIRED_LANGUAGE_RULES) {
    assert.ok(
      anySentenceMatchesAll(CONTROL_OK, rule.concepts),
      `Messwerkzeug defekt: die erlaubte Paraphrase erfuellt ${rule.label} nicht - die ` +
        "Zusicherung klebt am Wortlaut statt am Kern.",
    );
  }
  for (const rule of FORBIDDEN_LANGUAGE_RULES) {
    assert.ok(
      !anySentenceIsForbidden(CONTROL_OK, rule),
      `Messwerkzeug defekt: die erlaubte Paraphrase schlaegt bei "${rule.label}" an.`,
    );
  }

  for (const violation of CONTROL_VIOLATIONS) {
    assert.ok(
      FORBIDDEN_LANGUAGE_RULES.some((rule) => anySentenceIsForbidden(violation, rule)),
      `Messwerkzeug defekt: "${violation}" wird von keinem Verbot erfasst.`,
    );
  }

  assert.ok(
    !promptText().toLowerCase().includes(LOCK_SENTENCE.toLowerCase()),
    `${TEMPLATE_REL}: der Prompt traegt weiter "${LOCK_SENTENCE}". Ein Prompt, der den ` +
      "Sprachwechsel verbietet, und ein System-Werkzeug, das ihn leistet, arbeiten " +
      "gegeneinander - mal gewinnt das eine, mal das andere (E-5).",
  );

  for (const rule of REQUIRED_LANGUAGE_RULES) {
    assert.ok(
      anySentenceMatchesAll(promptText(), rule.concepts),
      `${TEMPLATE_REL}: der Prompt sagt nicht ${rule.label}. Verlangt ist der Sinn, nicht ` +
        "der Wortlaut: Sprache der Eroeffnung halten, bei Verdacht einmal zweisprachig " +
        "nachfragen, erst nach Bestaetigung wechseln, kein Wechsel wegen eines Wortes oder " +
        "Fragments, dasselbe Ziel weiterverfolgen - jedes in je einem Satz zusammenhaengend.",
    );
  }
  for (const rule of FORBIDDEN_LANGUAGE_RULES) {
    assert.ok(
      !anySentenceIsForbidden(promptText(), rule),
      `${TEMPLATE_REL}: der Prompt enthaelt "${rule.label}" - ${rule.why}.`,
    );
  }
});

const { withConfigOverrides } = makeConfigOverrides(config);

const GATE_CASES = Object.freeze([
  {
    name: "alle drei Faktoren offen",
    master: true,
    channel: true,
    allowConsult: true,
    allowed: true,
  },
  {
    name: "Tenant ohne Rueckfrage-Recht",
    master: true,
    channel: true,
    allowConsult: false,
    allowed: false,
  },
  { name: "Master-Schalter aus", master: false, channel: true, allowConsult: true, allowed: false },
  { name: "Kontext-Kanal aus", master: true, channel: false, allowConsult: true, allowed: false },
]);

const gateAnswerFor = (kase) =>
  withConfigOverrides({ consultEnabled: kase.master, assistantContextEnabled: kase.channel }, () =>
    consultAllowedFor({ allowConsult: kase.allowConsult }),
  );

const SEAM = Object.freeze({
  module: "../src/conversation/elevenlabs-agent-config.js",
  export: "outboundAgentConfigFor",
});

async function agentConfigSeam() {
  let module;
  try {
    module = await import(SEAM.module);
  } catch {
    module = null;
  }
  const build = module?.[SEAM.export];
  assert.equal(
    typeof build,
    "function",
    `NOCH NICHT GEBAUT: ${SEAM.module} exportiert ${SEAM.export}({ consultAllowed }) nicht. ` +
      "Solange es die Naht nicht gibt, gilt fuer den ElevenLabs-Pfad genau EIN Prompt - der " +
      `statische aus ${TEMPLATE_REL}, und der nennt get_consult in jeder Lage.`,
  );
  return build;
}

test("[abgenommen R16] der ElevenLabs-Prompt nennt get_consult nur, wenn das Rueckfrage-Gate es zulaesst", async () => {
  for (const kase of GATE_CASES) {
    assert.equal(gateAnswerFor(kase), kase.allowed, `Gate-Antwort im Fall "${kase.name}"`);
  }

  assert.ok(
    promptText().includes(CONSULT_TOOL),
    `${TEMPLATE_REL} nennt ${CONSULT_TOOL} im Prompt - diese Kontrolle greift`,
  );

  const build = await agentConfigSeam();
  for (const kase of GATE_CASES) {
    const allowed = gateAnswerFor(kase);
    const built = build({ consultAllowed: allowed });
    assert.equal(
      String(built?.prompt ?? "").includes(CONSULT_TOOL),
      allowed,
      `Fall "${kase.name}": der Prompt nennt ${CONSULT_TOOL} genau dann, wenn das Gate es ` +
        "zulaesst - sonst verspricht der Agent eine Rueckfrage, die nie kommt.",
    );
    assert.equal(
      (built?.toolNames ?? []).includes(CONSULT_TOOL),
      allowed,
      `Fall "${kase.name}": ${CONSULT_TOOL} haengt genau dann am Agenten, wenn das Gate es ` +
        "zulaesst - sonst versucht er einen Aufruf, den der Webhook ablehnt.",
    );
  }
});
