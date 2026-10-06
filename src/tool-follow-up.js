import { localeFor } from "./i18n/locales.js";
import { LLM_TOOL_CHOICE, forcedTool } from "./llm/tool-choice.js";

const UMLAUT_EXPANSIONS = Object.freeze([
  ["ä", "ae"],
  ["ö", "oe"],
  ["ü", "ue"],
  ["ß", "ss"],
]);
const COMBINING_MARKS = /\p{M}+/gu;

function comparableText(text) {
  let out = text.normalize("NFC").toLowerCase();
  for (const [from, to] of UMLAUT_EXPANSIONS) out = out.split(from).join(to);
  return out.normalize("NFD").replace(COMBINING_MARKS, "");
}

function matchesAnyMarker(text, markers) {
  if (!text) return false;
  const haystack = comparableText(text);
  return markers.some((parts) => parts.every((part) => haystack.includes(comparableText(part))));
}

export function announcesToolAction(text, language) {
  const followUp = localeFor(language).prompt.followUp;
  return matchesAnyMarker(text, [...followUp.consultMarkers, ...followUp.messageMarkers]);
}

export function announcesConsultAction(text, language) {
  return matchesAnyMarker(text, localeFor(language).prompt.followUp.consultMarkers);
}

export function followUpToolsFor({ enabled, alreadyUsed, text, language, candidateTools }) {
  if (!enabled) return null;
  if (alreadyUsed) return null;
  if (!candidateTools.length) return null;
  if (!announcesToolAction(text, language)) return null;
  return candidateTools;
}

export function followUpToolChoiceFor({ text, language, candidateTools, consultToolName }) {
  const consultOffered = candidateTools.some((tool) => tool.name === consultToolName);
  if (!consultOffered) return LLM_TOOL_CHOICE.REQUIRED;
  if (!announcesConsultAction(text, language)) return LLM_TOOL_CHOICE.REQUIRED;
  return forcedTool(consultToolName);
}
