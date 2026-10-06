import { readFileSync } from "node:fs";

import { GET_CONSULT_TOOL_NAME } from "../consult/in-call.js";

const TEMPLATE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";
const TEMPLATE = JSON.parse(readFileSync(new URL(`../../${TEMPLATE_REL}`, import.meta.url), "utf8"));

const DOC_KEY_PREFIX = "_";

const SECTION_SEPARATOR = "\n\n";

const DYNAMIC_VARIABLE = /\{\{\s*[A-Za-z0-9_]+\s*\}\}/g;

const conversationConfig = TEMPLATE.agent?.conversation_config ?? {};
const agentSection = conversationConfig.agent ?? {};
const promptSection = agentSection.prompt ?? {};

const FULL_PROMPT = promptSection.prompt ?? "";
const DECLARED_TOOL_NAMES = Object.keys(TEMPLATE.tools ?? {}).filter(
  (name) => !name.startsWith(DOC_KEY_PREFIX),
);

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

if (PROMPT_WITHOUT_CONSULT === FULL_PROMPT) {
  throw new Error(
    `${TEMPLATE_REL}: der Prompt nennt ${GET_CONSULT_TOOL_NAME} in keinem Abschnitt - dann ` +
      "liefert diese Naht bei offenem und bei gesperrtem Gate denselben Text und entscheidet " +
      "nichts. Entweder traegt die Vorlage den Rueckfrage-Abschnitt wieder, oder diese Naht " +
      "wird samt ihrer Verdrahtung entfernt.",
  );
}

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

const WITH_CONSULT = Object.freeze({
  prompt: FULL_PROMPT,
  toolNames: Object.freeze([...DECLARED_TOOL_NAMES]),
});
const WITHOUT_CONSULT = Object.freeze({
  prompt: PROMPT_WITHOUT_CONSULT,
  toolNames: Object.freeze(DECLARED_TOOL_NAMES.filter((name) => name !== GET_CONSULT_TOOL_NAME)),
});

export function outboundAgentConfigFor({ consultAllowed }) {
  return consultAllowed === true ? WITH_CONSULT : WITHOUT_CONSULT;
}
