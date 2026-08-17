// Konfigurationstests der ElevenLabs-Agenten-VORLAGE im Repo
// (elevenlabs/agent_configs/outbound-agent.template.json). Zwei Eigentuemer-
// Entscheidungen, zwei Baenke:
//
// D2 (Regressionsschutz, "npm test"): die Werkzeugliste des Agenten ist EXAKT gepinnt, in
//   beide Richtungen - kommt ein Werkzeug dazu, wird der Test rot; faellt eines weg,
//   ebenso. Beides ist dann eine bewusste Entscheidung mit einer Zeile Begruendung statt
//   einer stillen Aenderung. Muster ROUTE_FINGERPRINT aus test/route-auth-inventory.test.js,
//   samt Buchhaltungs-Kommentar an der Liste. Die Sorge dahinter ist KONFIGURATIONS-DRIFT,
//   nicht ein bestimmtes Werkzeug: ein Kriterium wird gruen oder rot, weil jemand am
//   Agenten etwas an- oder abgehaengt hat, und niemand merkt es. Gepinnt sind BEIDE Ablagen,
//   ueber die ein Werkzeug an den Agenten kommt: die tools-Karte der Vorlage und die
//   eingebauten Werkzeuge des Anbieters (prompt.built_in_tools). Ein einzelnes Werkzeug, das
//   ausdruecklich DRAUSSEN bleiben soll, bekommt zusaetzlich einen namentlichen Fall - die
//   Mengengleichheit allein wuerde beim gemeinsamen Nachziehen von Vorlage und Pin gruen
//   bleiben und die zurueckgestellte Entscheidung still neu treffen.
//
// E-5/E-6 (Regressionsschutz, "npm test"): dieselbe Ratsche, angewandt auf die
//   Sprachwechsel-Entscheidung. Der Prompt verbot den Wechsel ("Speak only in this
//   language"), das eingebaute language_detection leistet ihn - im Konflikt gewinnt mal das
//   eine, mal das andere. Die Faelle fordern die Aufloesung ein: Startsprache Englisch,
//   Wechsel erlaubt, Ziel unveraendert, kein Rueckwechsel-Zwang, Werkzeug und Zusatzsprache
//   am Agenten. Ein Abnahmekriterium ist das nicht, denn der Zustand muss ab der Aenderung
//   dauerhaft gelten - deshalb Regressionslauf, deshalb keine ABNAHME--Kennung.
//
// R16 ([abgenommen R16], gruen seit 2026-08-17, s. test/abnahme-ausgewandert.json - ab da
//   haelt der REGRESSIONSLAUF das Kriterium fest): der Prompt nennt get_consult nur, wenn
//   das Rueckfrage-Gate (src/consult/gate.js) es zulaesst. Nennt der Prompt ein Werkzeug,
//   das das Gate sperrt, verspricht der Agent seinem Gegenueber eine Rueckfrage, die nie
//   kommt - oder er versucht einen Aufruf, der abgelehnt wird.
//
// GEMESSEN (2026-08-14), warum R16 ueberhaupt ein Abnahmekriterium war:
//   - Bestandspfad: die Naht EXISTIERT. src/claude.js rendert consultRules(p) nur bei
//     p.consultAvailable, und agentTools(call) haengt das Werkzeug nur bei
//     consultAvailableFor(call) an. Beide Richtungen sind dort gepinnt
//     (test/ww-p3-consult-prompt-routing.test.js, gruen im Regressionslauf).
//   - ElevenLabs-Pfad: es gab NICHTS Vergleichbares. Die Vorlage ist eine statische
//     JSON-Datei, ihr Prompt trug den Block "CONSULT TOOL (get_consult)" bedingungslos,
//     und src/conversation/conversation-ports.js kennt in StartConversationParams kein
//     Feld, ueber das eine Gate-Antwort beim Laufwerk ueberhaupt ankaeme.
//   - GEBAUT 2026-08-17: src/conversation/elevenlabs-agent-config.js
//     (outboundAgentConfigFor) stellt Prompt und Werkzeugsatz aus der ANTWORT des Gates
//     zusammen. Die VERDRAHTUNG in den Anrufstart (src/elevenlabs/outbound.js) ist damit
//     noch nicht vollzogen - dieser Test pinnt die Naht, nicht den Aufrufer.
//
// KEIN NETZ, KEIN KONTO: gepinnt wird die VORLAGE IM REPO, nie der Agent im ElevenLabs-
// Konto. Ob Vorlage und Konto uebereinstimmen, ist Sache des Vor-dem-Hochladen-Gates
// (scripts/check-elevenlabs-tests.js, "npm run elevenlabs:check") - nicht dieses Tests.
//
// Testnamen tragen bewusst KEINE i18n-Katalog-ID am Namensanfang (package.json
// config.i18nCatalogPattern), sonst landen sie im Gates-Lauf statt in ihrer Bank
// (Lehre catalog-id-prefix-misroutes-tests).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { config } from "../src/config.js";
import { consultAllowedFor } from "../src/consult/gate.js";
import { makeConfigOverrides } from "./helpers.js";

// Der Werkzeugname steht hier als Literal, nicht als Import von GET_CONSULT_TOOL_NAME:
// geprueft wird eine PROVIDER-Konfiguration, deren Schreibweise im JSON steht. Ein Test,
// der beide Seiten aus derselben Quelle zoege, koennte ein Auseinanderlaufen nicht sehen
// (dieselbe Begruendung wie in test/ww-p3-consult-prompt-routing.test.js).
const CONSULT_TOOL = "get_consult";

const TEMPLATE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";
const TEMPLATE = JSON.parse(readFileSync(new URL(`../${TEMPLATE_REL}`, import.meta.url), "utf8"));

// Schluessel mit Unterstrich-Praefix sind Entwickler-Doku, kein Konfigurationsfeld -
// dieselbe Konvention, die scripts/check-elevenlabs-tests.js als DOC_KEY_PREFIX fuehrt.
const DOC_KEY_PREFIX = "_";
const configKeysOf = (obj) =>
  Object.keys(obj ?? {})
    .filter((key) => !key.startsWith(DOC_KEY_PREFIX))
    .sort();

// In Stufen gelesen statt in einer Kette: das Agenten-Objekt ist vier Ebenen tief
// (G36/Demeter, im Lint dieses Repos ein Fehler).
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

// Gepinntes Werkzeug-Inventar der Vorlage (Muster ROUTE_FINGERPRINT). EXAKT und in BEIDE
// Richtungen: ein Werkzeug mehr oder weniger macht diesen Test rot.
//
// BUCHHALTUNG - wann und warum diese Liste zuletzt geaendert wurde:
//   2026-08-14 angelegt mit genau EINEM Werkzeug: get_consult, die Rueckfrage an den
//   Auftraggeber (mit der Vorlage selbst entstanden). Kein Recherche-, kein Nachschlage-,
//   kein Kalender-Werkzeug - der Agent dieser Vorlage kann ausser sprechen nur genau das.
//   2026-08-14 BEWUSST UNVERAENDERT, obwohl ein Werkzeug dazukommt: language_detection
//   (E-5, Sprachwechsel) ist ein EINGEBAUTES Werkzeug des Anbieters und steht nicht in der
//   tools-Karte, die diese Liste pinnt - es zaehlt im BUILT_IN_TOOL_FINGERPRINT unten.
const TOOL_FINGERPRINT = ["get_consult"];

// Zweiter Fingerprint, weil ein Werkzeug nicht nur ueber die tools-Karte an den Agenten
// kommt: ElevenLabs haengt Faehigkeiten auch an weitere Felder des prompt-Objekts
// (eingebaute Werkzeuge, MCP-Server, Wissensdatenbank). Diese Datei kennt das
// Vokabular des Anbieters nicht vollstaendig und behauptet es auch nicht - sie pinnt
// stattdessen die KONFIGURATIONSFLAECHE: ein neues Feld im prompt-Objekt ist eine
// Aenderung am Werkzeugbestand, bis jemand das Gegenteil begruendet.
//
// BUCHHALTUNG:
//   2026-08-14 angelegt mit den zwei Feldern, die die Vorlage traegt.
//   2026-08-14 built_in_tools dazu (Eigentuemer-Entscheidung E-5): der Prompt verbot den
//   Sprachwechsel, ein System-Werkzeug leistet ihn - im Konflikt gewinnt mal das eine, mal
//   das andere, und genau dieser Nichtdeterminismus ist nicht debuggbar. Aufgeloest wird er
//   in EINE Richtung: der Prompt gibt den Wechsel frei, das eingebaute language_detection
//   erkennt ihn. Bis die Vorlage das Feld traegt, ist dieser Pin ROT - so gehoert es sich,
//   er fordert die Aenderung ein.
//   2026-08-14 llm, reasoning_effort und temperature dazu: die MODELLWAHL ist ab heute ein
//   besessenes Feld der Vorlage (Eintraege unter _besitz.felder). Grund ist kein neues
//   Werkzeug, sondern ein Messfehler-Muster: die Drift-Pruefung meldete "OK ueber alle 15
//   Felder", waehrend der Live-Agent auf einem anderen Modell stand als vorgesehen - das
//   Modell war schlicht nicht unter den verglichenen Feldern. An genau diesem Feld sind in
//   EINER Woche drei Messungen vorbeigelaufen (Spike 1b gegen gpt-4o-mini, A7 gegen
//   qwen36-35b-a3b, G6 nie vollzogen). Ein Gate, das am wichtigsten Feld vorbeischaut, ist
//   eine beruhigende Meldung ueber die falschen Felder; deshalb zaehlen die drei Stellschrauben
//   ab jetzt zur gepinnten Konfigurationsflaeche. Die WERTE pinnt dieser Test bewusst nicht -
//   sie sind vorlaeufig, solange die Modell-Leiter laeuft; gepinnt ist, DASS sie dastehen.
//   2026-08-15 timezone dazu (Eigentuemer-Entscheidung "prompt.timezone in die Besitz-Liste:
//   JA"): der Zeitzonen-FESTWERT am Agenten. Er ist heute WIRKUNGSLOS - seit 2026-08-15 reisen
//   {{owner_timezone}}, {{callee_timezone}} und {{today}} als dynamische Variablen mit, und der
//   Prompt-Abschnitt TIME AND TIME ZONES rechnet ausschliesslich mit ihnen. Gepinnt wird er
//   trotzdem, und genau deswegen: "wirkungslos, aber ungedeckt" ist der Zustand, in dem ein
//   stiller Wechsel im Anbieter-Dashboard niemandem auffiele - mit voller Wirkung in dem
//   Moment, in dem ein kuenftiger Prompt wieder auf den Festwert zurueckfaellt. Wie bei der
//   Modellwahl pinnt dieser Test nur, DASS das Feld dasteht, nicht seinen Wert.
const PROMPT_FIELD_FINGERPRINT = [
  "built_in_tools",
  "llm",
  "prompt",
  "reasoning_effort",
  "temperature",
  "timezone",
  "tool_ids",
];

// Eingebaute Werkzeuge des Anbieters (prompt.built_in_tools): sie werden nicht deklariert
// wie die tools-Karte, sondern nur an- oder abgeschaltet. Eigener Fingerprint, damit
// TOOL_FINGERPRINT weiter genau das misst, was die Vorlage selbst deklariert - und damit
// ein an- oder abgeschaltetes System-Werkzeug trotzdem nicht still passiert.
//
// BUCHHALTUNG:
//   2026-08-14 angelegt mit language_detection (E-5): das Werkzeug, das den im Prompt
//   freigegebenen Sprachwechsel waehrend des Anrufs ueberhaupt erkennt.
//   2026-08-14 end_call dazu (Kriterium A8, "Sauberer Abschluss mit Ergebnis"): dessen
//   fuenfte Erfolgsbedingung verlangt, dass der Agent den Anruf nach der Verabschiedung
//   AKTIV beendet - einen zweiten Hebel dafuer gibt es nicht. AUSDRUECKLICH NICHT wegen
//   R10: R10 ist in R6 aufgegangen, und K5 verlangt weiterhin den Abbruch durch UNSEREN
//   Zeitgeber - end_call ersetzt den nicht, es beendet nur ein bereits fertiges Gespraech.
//   2026-08-14 voicemail_detection dazu (Kriterium B5, Fall (c) Anrufbeantworter): ohne das
//   Werkzeug ist der Fall nicht abnehmbar. Die Faelle (a) niemand hebt ab und (b) besetzt
//   meldet der Anbieter ueber den Fehler-Webhook, beim Anrufbeantworter ausdruecklich NICHT.
//   2026-08-14 play_keypad_touch_tone BEWUSST NICHT (DTMF): kein Abnahmekriterium verlangt
//   es, die Entscheidung ist zurueckgestellt. Weil es am LIVE-Agenten liegt und damit
//   jederzeit still zurueckkommen kann, hat es unten einen eigenen, namentlichen Fall.
const BUILT_IN_TOOL_FINGERPRINT = ["end_call", "language_detection", "voicemail_detection"];

// Eingebautes Werkzeug, das die Vorlage bewusst NICHT fuehrt. Der Live-Agent traegt es heute
// (Drift-Befund 2026-08-14: live end_call, language_detection, play_keypad_touch_tone,
// voicemail_detection gegen die Vorlage) - eine Rueckkehr in die Vorlage ist also kein
// theoretischer Fall, sondern der wahrscheinlichere. Eigener Fall statt nur Mengengleichheit
// oben: der Mengen-Pin sagt "die Menge stimmt nicht", er sagt nicht "hier kommt eine schon
// getroffene Entscheidung wieder" - und wer ihn nachzieht, trifft sie still neu.
const DEFERRED_BUILT_IN_TOOL = "play_keypad_touch_tone";

// Zusatzsprachen des Agenten (conversation_config.language_presets). Die SCHLUESSEL dieser
// Karte sind die Sprachen; ein Eintrag traegt seine Uebersetzungen (overrides,
// first_message_translation, soft_timeout_translation), die dieser Pin nicht vorschreibt -
// gepinnt wird, WELCHE Sprachen der Agent kann, nicht wie sie ausformuliert sind.
//
// BUCHHALTUNG:
//   2026-08-14 angelegt mit "es" (E-5/E-6: language_detection und Spanisch werden am
//   Agenten gesetzt). Zweibuchstabig wie agent.language ("en"); braucht der Anbieter je
//   einen Regionalcode ("es-ES"), ist das eine Aenderung mit einer Zeile Begruendung.
//   2026-08-17 "de" und "fr" dazu, und der Grund ist NICHT "eine Sprache mehr": beide
//   tragen den Offenlegungssatz IHRER Sprache (overrides.agent.first_message, woertlich
//   aus src/i18n/locales.js). Anruf 2 am selben Tag hat am Ohr des Eigentuemers belegt,
//   dass ein deutscher Angerufener den ENGLISCHEN Satz hoert - Fertig-Punkt 10 verlangt
//   die Sprache des Angerufenen. Warum nicht auch "es": fuer Spanisch fuehrt der Code
//   keinen kuratierten Satz, und einen zu uebersetzen waere eine erfundene Rechtsaussage.
//   Der INHALT ist bewusst nicht hier gepinnt, sondern in test/elevenlabs-anrufstart.test.js
//   (T5 e) - dieser Pin bleibt eine Faehigkeitsliste.
const LANGUAGE_PRESET_FINGERPRINT = ["de", "es", "fr"];

const DRIFT_HINT =
  "Das ist erlaubt - aber nur bewusst: Liste in test/elevenlabs-agent-werkzeuge.test.js " +
  "nachziehen UND im Buchhaltungs-Kommentar in einer Zeile begruenden, was dazu kam oder " +
  "wegfiel. Ein Werkzeug, das still auftaucht oder verschwindet, dreht Abnahmekriterien " +
  "gruen oder rot, ohne dass jemand es entschieden hat.";

test("Werkzeug-Inventar der ElevenLabs-Vorlage: exakt die gepinnte Menge, in beide Richtungen", () => {
  // Positiv-Kontrolle: ein leeres Inventar bestuende die Gleichheitspruefung auch dann,
  // wenn der Leser oben gar nichts mehr faende (Lehre pruefkommando-ohne-positiv-kontrolle).
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

  // Positiv-Kontrollen des Messwerkzeugs, eine je Ablage: ohne sie waere "nicht gefunden"
  // von "an der falschen Stelle gesucht" nicht zu unterscheiden
  // (Lehre pruefkommando-ohne-positiv-kontrolle).
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

  // Zweite Richtung, und der eigentliche Grund fuer diesen Fall: auch der Pin darf das
  // Werkzeug nicht tragen. Sonst genuegte es, Vorlage UND Pin gemeinsam zu ergaenzen - die
  // Mengengleichheit oben bliebe gruen, und die zurueckgestellte Entscheidung waere still
  // getroffen. Genau das soll hier auffallen.
  assert.ok(
    !BUILT_IN_TOOL_FINGERPRINT.includes(DEFERRED_BUILT_IN_TOOL),
    `Der Pin traegt ${DEFERRED_BUILT_IN_TOOL}. Die Aufnahme ist erlaubt - aber nur als eigene ` +
      "Entscheidung: erst das Kriterium benennen, das DTMF verlangt, dann diesen Fall hier " +
      "loeschen und die Buchhaltung am Pin um eine Zeile ergaenzen.",
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

  // Solange die Kennung noch ein <AUSFUELLEN: ...>-Platzhalter ist, laesst sie sich einem
  // Werkzeug zuordnen; nach dem Push steht dort eine Konto-Kennung, die keinen Namen mehr
  // traegt - dann greift nur noch die Mengengleichheit oben. Beide Zustaende sind gueltig.
  for (const entry of ids.filter((id) => String(id).includes("AUSFUELLEN"))) {
    assert.ok(
      declaredToolNames().some((name) => String(entry).includes(name)),
      `Die Platzhalter-Kennung "${entry}" nennt kein deklariertes Werkzeug.`,
    );
  }
});

// --- Sprachwechsel (E-5/E-6) -----------------------------------------------------------
//
// Regressionsschutz, KEIN Abnahmekriterium (deshalb ohne ABNAHME--Kennung): die Faelle
// fordern einen Zustand ein, der ab der Aenderung dauerhaft gelten muss. Heute rot, weil
// die Vorlage noch die alte Sprach-Sperre traegt.

// Wo genau only_at_conversation_start unter language_detection sitzt, ist in der belegten
// Feldliste nicht festgelegt (Konfigurationsobjekt des Werkzeugs, moeglicherweise verschachtelt).
// Gepinnt wird deshalb die WIRKUNG statt der Verschachtelung: nirgends im Teilbaum steht der
// Schalter auf true. Fehlt er ganz, gilt die Anbieter-Vorgabe false - auch das ist richtig.
const ONLY_AT_START_KEY = "only_at_conversation_start";
const onlyAtStartAnywhere = (node) => {
  if (node === null || typeof node !== "object") return false;
  if (node[ONLY_AT_START_KEY] === true) return true;
  return Object.values(node).some((child) => onlyAtStartAnywhere(child));
};

// Der Satz, den E-5 streicht - woertlich, weil er woertlich in der Vorlage steht.
const LOCK_SENTENCE = "Speak only in this language";

// Die Sprachregel im Prompt wird auf ihren KERN geprueft, nicht auf den Wortlaut: jede
// Zusicherung ist eine Menge von Begriffen, die IN EINEM SATZ zusammen vorkommen muessen.
// Satzweise statt prompt-weit, weil "Begin the call in English" und "never switch the
// language" sonst gemeinsam gruen waeren - also genau der Widerspruch, den E-5 aufloest.
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

const REQUIRED_LANGUAGE_RULES = Object.freeze([
  {
    label: "(a) Englisch ist die Startsprache des Anrufs",
    concepts: [/\b(begin|start|open)\w*/i, ENGLISH],
  },
  {
    label: "(b) wechselt die Gegenseite die Sprache, geht der Agent mit",
    concepts: [SWITCH_VERB, FOLLOW_VERB, LANGUAGE_WORD],
  },
  {
    label: "(c) das Ziel bleibt dabei unveraendert dasselbe",
    concepts: [/\b(same|unchanged|identical)\b/i, /\b(objective|goal|task|purpose|mission)\w*/i],
  },
]);

const FORBIDDEN_LANGUAGE_RULES = Object.freeze([
  {
    label: "Sprach-Sperre (nur eine Sprache erlaubt)",
    concepts: [/\b(only|exclusively|solely)\b/i, LANGUAGE_WORD],
    why: "ein Prompt, der auf eine Sprache festnagelt, arbeitet gegen language_detection",
  },
  {
    label: "Wechsel-Verbot",
    concepts: [NEGATION, SWITCH_VERB, LANGUAGE_WORD],
    why: "derselbe Widerspruch, nur negativ formuliert",
  },
  {
    label: "Rueckwechsel-Pflicht",
    concepts: [/\b(back|return|revert)\w*/i, ENGLISH],
    why: "vom Eigentuemer ausdruecklich benannt: derselbe Fehler in gruen",
  },
]);

// Positiv-Kontrollen des Messwerkzeugs (Lehre pruefkommando-ohne-positiv-kontrolle). Die
// erlaubte Fassung ist bewusst eine PARAPHRASE der Eigentuemer-Formulierung: die
// Zusicherungen duerfen nicht am Wortlaut kleben, sondern muessen auch anders formulierte
// Prompts durchlassen - und auf jeder der drei verbotenen Formen anschlagen.
const CONTROL_OK =
  "Open the conversation in English. Should your counterpart move to a different " +
  "language, carry on in that language and keep working toward the same goal.";
const CONTROL_VIOLATIONS = Object.freeze([
  "Speak only in this language: {{language}}.",
  "Never switch the language during the call.",
  "If they switch, follow them, but return to English right after.",
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

test("Sprachwechsel in der ElevenLabs-Vorlage: der Prompt setzt die Startsprache, gibt den Wechsel frei und verlangt keinen Rueckwechsel", () => {
  // 1. Kontrolle am Messwerkzeug: die Paraphrase besteht alle drei Zusicherungen und
  //    verletzt keines der drei Verbote - die Pruefung haengt nicht am Wortlaut.
  for (const rule of REQUIRED_LANGUAGE_RULES) {
    assert.ok(
      anySentenceMatchesAll(CONTROL_OK, rule.concepts),
      `Messwerkzeug defekt: die erlaubte Paraphrase erfuellt ${rule.label} nicht - die ` +
        "Zusicherung klebt am Wortlaut statt am Kern.",
    );
  }
  for (const rule of FORBIDDEN_LANGUAGE_RULES) {
    assert.ok(
      !anySentenceMatchesAll(CONTROL_OK, rule.concepts),
      `Messwerkzeug defekt: die erlaubte Paraphrase schlaegt bei "${rule.label}" an.`,
    );
  }

  // 2. Kontrolle in die andere Richtung: jede verbotene Form wird auch erkannt. Ohne sie
  //    waere ein Verbot, das nie anschlaegt, von einem erfuellten nicht zu unterscheiden.
  for (const violation of CONTROL_VIOLATIONS) {
    assert.ok(
      FORBIDDEN_LANGUAGE_RULES.some((rule) => anySentenceMatchesAll(violation, rule.concepts)),
      `Messwerkzeug defekt: "${violation}" wird von keinem Verbot erfasst.`,
    );
  }

  // 3. Der woertliche Satz, den E-5 streicht.
  assert.ok(
    !promptText().toLowerCase().includes(LOCK_SENTENCE.toLowerCase()),
    `${TEMPLATE_REL}: der Prompt traegt weiter "${LOCK_SENTENCE}". Ein Prompt, der den ` +
      "Sprachwechsel verbietet, und ein System-Werkzeug, das ihn leistet, arbeiten " +
      "gegeneinander - mal gewinnt das eine, mal das andere (E-5).",
  );

  // 4. Der Kern: Startsprache, Wechsel erlaubt, Ziel unveraendert - in beliebiger Formulierung.
  for (const rule of REQUIRED_LANGUAGE_RULES) {
    assert.ok(
      anySentenceMatchesAll(promptText(), rule.concepts),
      `${TEMPLATE_REL}: der Prompt sagt nicht ${rule.label}. Verlangt ist der Sinn, nicht ` +
        "der Wortlaut: Startsprache festlegen, Wechsel bei der Gegenseite mitgehen, dasselbe " +
        "Ziel weiterverfolgen - alles drei in je einem Satz zusammenhaengend.",
    );
  }
  for (const rule of FORBIDDEN_LANGUAGE_RULES) {
    assert.ok(
      !anySentenceMatchesAll(promptText(), rule.concepts),
      `${TEMPLATE_REL}: der Prompt enthaelt "${rule.label}" - ${rule.why}.`,
    );
  }
});

// --- R16 -------------------------------------------------------------------------------

const { withConfigOverrides } = makeConfigOverrides(config);

// Die drei Faktoren des Gates (src/consult/gate.js), je einzeln zugedreht. Vier Faelle
// statt zwei: ein Gate, das immer dasselbe antwortet, wuerde die Richtungspruefung
// darunter trivial bestehen.
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

// Die NAHT, die R16 verlangt - hier VOR dem Bau gepinnt, wie
// test/elevenlabs-consult-webhook-blockers.test.js den Namen
// recordElevenlabsConversationId vor dem Bau gepinnt hat.
//   ORT: src/conversation/ ist der im Kopf von conversation-ports.js begruendete Platz
//     fuer den KI-Gespraechsdienst (telephony/ traegt nur die Leitung).
//   EINGABE: die ANTWORT des Gates, nicht das Tenant-Profil - die Entscheidung faellt in
//     src/consult/gate.js und darf nicht ein zweites Mal nachgebaut werden. Genau dieser
//     Nachbau war Blocker BL-2 des Rueckfrage-Webhooks.
//   RUECKGABE: { prompt: string, toolNames: string[] }. Werkzeug-NAMEN, nicht die
//     ElevenLabs-Kennungen: die entstehen erst im Konto, und ein Test greift nicht ins
//     Netz. Weitere Felder darf die Naht liefern, dieser Test liest nur diese zwei.
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
  // 1. Das Gate misst wirklich in beide Richtungen (Kontrolle, gruen).
  for (const kase of GATE_CASES) {
    assert.equal(gateAnswerFor(kase), kase.allowed, `Gate-Antwort im Fall "${kase.name}"`);
  }

  // 2. Kontrolle am Artefakt: die Vorlage nennt das Werkzeug ueberhaupt. Ohne sie waere
  //    die gesperrte Richtung unten von einem Prompt, der get_consult NIE nennt, nicht zu
  //    unterscheiden.
  assert.ok(
    promptText().includes(CONSULT_TOOL),
    `${TEMPLATE_REL} nennt ${CONSULT_TOOL} im Prompt - diese Kontrolle greift`,
  );

  // 3. Die eigentliche Pruefung, beide Richtungen ueber dieselbe Naht.
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
