import { kiHinweisKernFor } from "../i18n/eroeffnung.ts";
import { SUPPORTED_LANGUAGES, disclosurePrefixFor } from "../i18n/locales.ts";
import { openingLineHash } from "../store/state-ops.js";

export const OPENING_LINE_MAX_CHARS = 120;

export const OPENING_QUESTION_MAX_CHARS = 40;

const FORBIDDEN_CHARS = /[[\]{}\n\r\t]/;
const PRICE_PATTERNS = [/\d[\d.,]*\s*(?:€|\$|eur\b|usd\b|euro\b|dollar)/i, /[€$]\s*\d/];
const SENTENCE_END = /[.!?]$/;
const GRUSS_AM_SATZANFANG =
  /[.!?:]\s+(?:hallo|hi|hey|hello|bonjour|bonsoir|salut|guten (?:tag|morgen|abend)|good (?:morning|afternoon|evening))\b/i;
const VORSTELLUNG = /\b(?:hier spricht|mein name ist|my name is|je m'appelle)\b/i;
const HIER_IST_NAME = /\b[Hh]ier ist\s+\p{Lu}/u;
const VORSTELLUNG_MIT_NAMEN = /\b(?:[Ii]ch bin|I am|I['\u2019]m|[Jj]e suis|[Tt]his is|[Cc]['\u2019]est|[Ii]ci) \p{Lu}\p{L}/u;
const EIGENE_VORSTELLUNGEN = [GRUSS_AM_SATZANFANG, VORSTELLUNG, HIER_IST_NAME, VORSTELLUNG_MIT_NAMEN];
const eigenerGrussOderName = (zeile: string): boolean => EIGENE_VORSTELLUNGEN.some((muster) => muster.test(zeile));

interface Sprachtexte {
  bridgePhrase: (ziel: string) => string;
  openingQuestion: string;
  openingReasonFallback: string;
}

interface Anruf {
  id: string;
  goal?: unknown;
  openingLine?: unknown;
  openingLineSha256?: unknown;
}

const QUESTION_MARK = "?";
const fragtHoechstensAmEnde = (line: string): boolean => {
  const i = line.indexOf(QUESTION_MARK);
  return i === -1 || i === line.length - 1;
};

const praefixFuer: (language: string) => string = disclosurePrefixFor;
const kernFuer: (language: string) => string = kiHinweisKernFor;

const DISCLOSURE_CORES = SUPPORTED_LANGUAGES.flatMap((lang: string): string[] => {
  const prefix = praefixFuer(lang);
  return [
    prefix.slice(prefix.indexOf(",") + 1).trim().toLowerCase(),
    kernFuer(lang).toLowerCase(),
  ];
});
if (DISCLOSURE_CORES.some((core) => core.length === 0)) {
  throw new Error(
    "opening-line.js: ein Offenlegungs-Kern ist leer - die Ableitung aus LOCALES traegt " +
      "fuer mindestens eine Sprache nicht (Name vor dem ersten Komma?). Ableitung " +
      "anpassen, nicht den Waechter entfernen.",
  );
}

export function validOpeningLine(candidate: unknown): string | null {
  if (typeof candidate !== "string") return null;
  const line = candidate.trim();
  if (!line || line.length > OPENING_LINE_MAX_CHARS) return null;
  if (FORBIDDEN_CHARS.test(line)) return null;
  if (!SENTENCE_END.test(line)) return null;
  if (!fragtHoechstensAmEnde(line)) return null;
  if (PRICE_PATTERNS.some((pattern) => pattern.test(line))) return null;
  if (eigenerGrussOderName(line)) return null;
  const lower = line.toLowerCase();
  if (DISCLOSURE_CORES.some((core) => lower.includes(core))) return null;
  return line;
}

const ICH_FORM_PREFIX: Readonly<Record<string, string>> = Object.freeze({
  de: "ich rufe an, um ",
  en: "i am calling to ",
  fr: "j'appelle pour ",
});
const INNERE_SATZENDEN = [". ", "!", "?"];

export function ichFormOpeningLine(candidate: unknown, language: string): string | null {
  const line = validOpeningLine(candidate);
  if (!line?.endsWith(".")) return null;
  const prefix = ICH_FORM_PREFIX[language];
  if (!prefix || !line.toLowerCase().replace("\u2019", "'").startsWith(prefix)) return null;
  return INNERE_SATZENDEN.some((ende) => line.includes(ende)) ? null : line;
}

export function bridgedObjective(objective: unknown, locale: Sprachtexte): string | null {
  if (typeof objective !== "string") return null;
  const normalized = objective.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.endsWith(QUESTION_MARK)) return null;
  const ohneSatzende = normalized.replace(/[.!]+$/, "").trim();
  if (!ohneSatzende) return null;
  return validOpeningLine(locale.bridgePhrase(ohneSatzende));
}

export function composedOpeningLine(reason: string, locale: Sprachtexte): string {
  return reason.endsWith(QUESTION_MARK) ? reason : `${reason} ${locale.openingQuestion}`;
}

const gespeicherteZeile = (call: Anruf): string | null =>
  typeof call.openingLine === "string" && call.openingLineSha256 === openingLineHash(call.openingLine)
    ? call.openingLine
    : null;

export function verifiedOpeningLine({ call, locale }: { call: Anruf; locale: Sprachtexte }): string {
  const gespeichert = gespeicherteZeile(call);
  if (gespeichert !== null && !gespeichert.includes(QUESTION_MARK)) return gespeichert;
  if (gespeichert === null && (call.openingLine != null || call.openingLineSha256 != null)) {
    console.warn(
      `[opening-line] veraendert call=${call.id} - gespeicherte Zeile passt nicht ` +
        `zum Annahme-Hash, deterministischer Rueckfall greift`,
    );
  }
  return bridgedObjective(call.goal, locale) ?? locale.openingReasonFallback;
}

export function ownerOpeningLine({ call, locale }: { call: Anruf; locale: Sprachtexte }): string {
  const reason = verifiedOpeningLine({ call, locale });
  const gespeichert = gespeicherteZeile(call);
  return gespeichert ?? composedOpeningLine(reason, locale);
}
