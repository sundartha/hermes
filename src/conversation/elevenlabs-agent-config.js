// ---- Agenten-Konfiguration EINES ElevenLabs-Anrufs: Prompt + Werkzeugsatz (R16) -------
// Bis hierher galt auf dem ElevenLabs-Weg genau EIN Prompt - der statische aus der Vorlage
// - und der nannte get_consult in JEDER Lage. Das Rueckfrage-Gate (src/consult/gate.js)
// kann den Weg aber zudrehen; dann verspricht der Agent seinem Gegenueber eine Rueckfrage,
// die nie kommt, oder er ruft ein Werkzeug, das der Webhook ablehnt.
//
// VORBILD IST DER BESTANDSWEG, nicht eine neue Erfindung: src/claude.js rendert
// consultRules(p) nur bei p.consultAvailable (ein GANZER Block oder gar nichts,
// filter(Boolean)) und haengt das Werkzeug in agentTools(call) an dasselbe Praedikat.
// Genau diese zwei Haelften - Prompt und Werkzeugsatz aus EINER Antwort - baut diese Datei
// fuer den ElevenLabs-Weg nach.
//
// DAS GATE WIRD NICHT NACHGEBAUT: die Entscheidung faellt in consultAllowedFor
// (src/consult/gate.js) und reist als fertige ANTWORT herein. Ein zweiter Nachbau des
// Gates war Blocker BL-2 des Rueckfrage-Webhooks - er wird hier nicht wiederholt. Der
// boolesche Parameter ist deshalb KEIN Verhaltensschalter des Aufrufers (F3/G15), sondern
// die durchgereichte Antwort einer fremden Entscheidung.
//
// ORT: src/conversation/ ist der im Kopf von conversation-ports.js begruendete Platz fuer
// den KI-Gespraechsdienst (telephony/ traegt nur die Leitung).
//
// KEIN NETZ, KEIN KONTO: Quelle ist die VORLAGE IM REPO. Die Werkzeug-NAMEN sind das, was
// diese Datei liefert, nicht die ElevenLabs-Kennungen - die entstehen erst im Konto
// (tool_ids der Vorlage tragen bis dahin <AUSFUELLEN: ...>).
import { readFileSync } from "node:fs";

import { GET_CONSULT_TOOL_NAME } from "../consult/in-call.js";

const TEMPLATE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";
const TEMPLATE = JSON.parse(readFileSync(new URL(`../../${TEMPLATE_REL}`, import.meta.url), "utf8"));

// Schluessel mit Unterstrich-Praefix sind repo-eigene Doku bzw. Daten, KEIN Feld des
// ElevenLabs-Schemas (Konvention der Vorlage, _platzhalter_konvention; dieselbe, die
// scripts/check-elevenlabs-tests.js als DOC_KEY_PREFIX fuehrt).
const DOC_KEY_PREFIX = "_";

// Der Prompt der Vorlage ist in Abschnitte gegliedert, getrennt durch eine LEERZEILE
// (Ueberschrift in Grossbuchstaben, dann der Text). Der Abschnitt ist damit die Einheit,
// die als Ganzes wegfallen kann - wie die Bloecke in systemPrompt() (src/claude.js).
const SECTION_SEPARATOR = "\n\n";

// Die dynamischen Platzhalter des Anbieters ({{name}}, s. _platzhalter_konvention der
// Vorlage). Gebraucht wird hier nur ihr VORKOMMEN, nicht ihr Name - deshalb ohne Gruppe.
const DYNAMIC_VARIABLE = /\{\{\s*[A-Za-z0-9_]+\s*\}\}/g;

// In Stufen gelesen statt in einer Kette: das Agenten-Objekt ist vier Ebenen tief
// (G36/Demeter).
const conversationConfig = TEMPLATE.agent?.conversation_config ?? {};
const agentSection = conversationConfig.agent ?? {};
const promptSection = agentSection.prompt ?? {};

const FULL_PROMPT = promptSection.prompt ?? "";
const DECLARED_TOOL_NAMES = Object.keys(TEMPLATE.tools ?? {}).filter(
  (name) => !name.startsWith(DOC_KEY_PREFIX),
);

// Die Regel, in EINEM Satz: faellt der Rueckfrage-Weg weg, faellt jeder Abschnitt weg, der
// das Werkzeug nennt. Keine Satz-Chirurgie im Fliesstext - ein halber Satz weniger ergibt
// eine Anweisung, die niemand geschrieben hat.
function withoutConsultSections(prompt) {
  return prompt
    .split(SECTION_SEPARATOR)
    .filter((section) => !section.includes(GET_CONSULT_TOOL_NAME))
    .join(SECTION_SEPARATOR);
}

function dynamicVariablesIn(text) {
  return [...new Set(text.match(DYNAMIC_VARIABLE) ?? [])];
}

const PROMPT_WITHOUT_CONSULT = withoutConsultSections(FULL_PROMPT);

// Positiv-Kontrolle des Messwerkzeugs (Lehre pruefkommando-ohne-positiv-kontrolle): eine
// Vorlage, die get_consult gar nicht nennt, liefert in BEIDEN Richtungen denselben Prompt -
// die Naht saehe aus, als arbeite sie, und entschiede nichts.
if (PROMPT_WITHOUT_CONSULT === FULL_PROMPT) {
  throw new Error(
    `${TEMPLATE_REL}: der Prompt nennt ${GET_CONSULT_TOOL_NAME} in keinem Abschnitt - dann ` +
      "liefert diese Naht bei offenem und bei gesperrtem Gate denselben Text und entscheidet " +
      "nichts. Entweder traegt die Vorlage den Rueckfrage-Abschnitt wieder, oder diese Naht " +
      "wird samt ihrer Verdrahtung entfernt.",
  );
}

// Die Gegenrichtung, und der eigentliche Riegel (G27: Struktur statt Konvention): ein
// Abschnitt, der das Werkzeug nennt UND einen Auftragsplatzhalter traegt, wuerde beim
// Wegfallen den Auftrag mitnehmen. Genau so stand es bis R16 im Abschnitt MANDATE AND
// BOOKING. Fail-closed beim LADEN, weil die Vorlage statisch ist: der Fehler ist damit
// deterministisch und faellt im Test auf, nicht mitten im Anruf.
const LOST_VARIABLES = dynamicVariablesIn(FULL_PROMPT).filter(
  (variable) => !PROMPT_WITHOUT_CONSULT.includes(variable),
);
if (LOST_VARIABLES.length > 0) {
  throw new Error(
    `${TEMPLATE_REL}: ohne den Rueckfrage-Weg verliert der Prompt die Platzhalter ` +
      `${LOST_VARIABLES.join(", ")}. Ein Abschnitt, der ${GET_CONSULT_TOOL_NAME} nennt, traegt ` +
      "damit zugleich Auftragsinhalt - er kann nicht als Ganzes wegfallen. Den Inhalt in " +
      "einen eigenen Abschnitt trennen (s. _rueckfrage_gate_hinweis in der Vorlage).",
  );
}

// Beide Fassungen entstehen EINMAL beim Laden: die Vorlage ist statisch, ein Neubau je
// Anruf waere dieselbe Rechnung mit demselben Ergebnis. Eingefroren, weil sie geteilt sind.
const WITH_CONSULT = Object.freeze({
  prompt: FULL_PROMPT,
  toolNames: Object.freeze([...DECLARED_TOOL_NAMES]),
});
const WITHOUT_CONSULT = Object.freeze({
  prompt: PROMPT_WITHOUT_CONSULT,
  toolNames: Object.freeze(DECLARED_TOOL_NAMES.filter((name) => name !== GET_CONSULT_TOOL_NAME)),
});

/**
 * Prompt und Werkzeug-Namen des Anbieter-Agenten fuer EINEN Anruf.
 *
 * @param {Object} params
 * @param {boolean} params.consultAllowed - die ANTWORT von consultAllowedFor
 *   (src/consult/gate.js), nicht das Tenant-Profil. Fail-closed: alles ausser einem echten
 *   true gilt als gesperrt (dieselbe Haltung wie im Gate selbst).
 * @returns {{ prompt: string, toolNames: string[] }} - Werkzeug-NAMEN, nicht die
 *   ElevenLabs-Kennungen; die entstehen erst im Konto.
 */
export function outboundAgentConfigFor({ consultAllowed }) {
  return consultAllowed === true ? WITH_CONSULT : WITHOUT_CONSULT;
}
