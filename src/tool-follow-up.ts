import { localeFor } from "./i18n/locales.js";
import { LLM_TOOL_CHOICE, forcedTool } from "./llm/tool-choice.js";

type Marker = readonly (readonly string[])[];

const sprachtexte: (language: string) => {
  prompt: { followUp: { consultMarkers: Marker; messageMarkers: Marker } };
} = localeFor;

const UMLAUT_EXPANSIONS: readonly (readonly [string, string])[] = Object.freeze([
  ["ä", "ae"],
  ["ö", "oe"],
  ["ü", "ue"],
  ["ß", "ss"],
]);
const COMBINING_MARKS = /\p{M}+/gu;

function comparableText(text: string): string {
  let out = text.normalize("NFC").toLowerCase();
  for (const [from, to] of UMLAUT_EXPANSIONS) out = out.split(from).join(to);
  return out.normalize("NFD").replace(COMBINING_MARKS, "");
}

function matchesAnyMarker(text: string | null | undefined, markers: Marker): boolean {
  if (!text) return false;
  const haystack = comparableText(text);
  return markers.some((parts) => parts.every((part) => haystack.includes(comparableText(part))));
}

export function announcesToolAction(text: string | null | undefined, language: string): boolean {
  const followUp = sprachtexte(language).prompt.followUp;
  return matchesAnyMarker(text, [...followUp.consultMarkers, ...followUp.messageMarkers]);
}

export function announcesConsultAction(text: string | null | undefined, language: string): boolean {
  return matchesAnyMarker(text, sprachtexte(language).prompt.followUp.consultMarkers);
}

interface Werkzeug {
  name: string;
}

export function followUpToolsFor<T extends Werkzeug>({
  enabled,
  alreadyUsed,
  text,
  language,
  candidateTools,
}: {
  enabled: boolean;
  alreadyUsed: boolean;
  text: string | null | undefined;
  language: string;
  candidateTools: readonly T[];
}): readonly T[] | null {
  if (!enabled) return null;
  if (alreadyUsed) return null;
  if (!candidateTools.length) return null;
  if (!announcesToolAction(text, language)) return null;
  return candidateTools;
}

export function followUpToolChoiceFor({
  text,
  language,
  candidateTools,
  consultToolName,
}: {
  text: string | null | undefined;
  language: string;
  candidateTools: readonly Werkzeug[];
  consultToolName: string;
}): string | { tool: string } {
  const consultOffered = candidateTools.some((tool) => tool.name === consultToolName);
  if (!consultOffered) return LLM_TOOL_CHOICE.REQUIRED;
  if (!announcesConsultAction(text, language)) return LLM_TOOL_CHOICE.REQUIRED;
  return forcedTool(consultToolName);
}
