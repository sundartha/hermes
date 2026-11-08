import { SUPPORTED_LANGUAGES, aiSentenceFrameFor, disclosurePrefixFor } from "../i18n/locales.js";
import { openingLineHash } from "../store/state-ops.js";

export const OPENING_LINE_MAX_CHARS = 120;

export const OPENING_QUESTION_MAX_CHARS = 40;

const FORBIDDEN_CHARS = /[[\]{}\n\r\t]/;
const PRICE_PATTERNS = [/\d[\d.,]*\s*(?:€|\$|eur\b|usd\b|euro\b|dollar)/i, /[€$]\s*\d/];
const SENTENCE_END = /[.!?]$/;

const QUESTION_MARK = "?";
const fragtHoechstensAmEnde = (line) => {
  const i = line.indexOf(QUESTION_MARK);
  return i === -1 || i === line.length - 1;
};

const DISCLOSURE_CORES = SUPPORTED_LANGUAGES.flatMap((lang) => {
  const prefix = disclosurePrefixFor(lang);
  return [
    prefix.slice(prefix.indexOf(",") + 1).trim().toLowerCase(),
    aiSentenceFrameFor(lang).pre.trim().toLowerCase(),
  ];
});
if (DISCLOSURE_CORES.some((core) => core.length === 0)) {
  throw new Error(
    "opening-line.js: ein Offenlegungs-Kern ist leer - die Ableitung aus LOCALES traegt " +
      "fuer mindestens eine Sprache nicht (Name vor dem ersten Komma?). Ableitung " +
      "anpassen, nicht den Waechter entfernen.",
  );
}

export function validOpeningLine(candidate) {
  if (typeof candidate !== "string") return null;
  const line = candidate.trim();
  if (!line || line.length > OPENING_LINE_MAX_CHARS) return null;
  if (FORBIDDEN_CHARS.test(line)) return null;
  if (!SENTENCE_END.test(line)) return null;
  if (!fragtHoechstensAmEnde(line)) return null;
  if (PRICE_PATTERNS.some((pattern) => pattern.test(line))) return null;
  const lower = line.toLowerCase();
  if (DISCLOSURE_CORES.some((core) => lower.includes(core))) return null;
  return line;
}

const ICH_FORM_PREFIX = Object.freeze({
  de: "ich rufe an, um ",
  en: "i am calling to ",
  fr: "j'appelle pour ",
});
const INNERE_SATZENDEN = [". ", "!", "?"];

export function ichFormOpeningLine(candidate, language) {
  const line = validOpeningLine(candidate);
  if (!line || !line.endsWith(".")) return null;
  const prefix = ICH_FORM_PREFIX[language];
  if (!prefix || !line.toLowerCase().replace("\u2019", "'").startsWith(prefix)) return null;
  return INNERE_SATZENDEN.some((ende) => line.includes(ende)) ? null : line;
}

export function bridgedObjective(objective, locale) {
  if (typeof objective !== "string") return null;
  const normalized = objective.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.endsWith(QUESTION_MARK)) return null;
  const ohneSatzende = normalized.replace(/[.!]+$/, "").trim();
  if (!ohneSatzende) return null;
  return validOpeningLine(locale.bridgePhrase(ohneSatzende));
}

export function composedOpeningLine(reason, locale) {
  return reason.endsWith(QUESTION_MARK) ? reason : `${reason} ${locale.openingQuestion}`;
}

const hashGueltig = ({ openingLine, openingLineSha256 }) =>
  typeof openingLine === "string" && openingLineSha256 === openingLineHash(openingLine);

export function verifiedOpeningLine({ call, locale }) {
  const gueltig = hashGueltig(call);
  if (gueltig && !call.openingLine.includes(QUESTION_MARK)) return call.openingLine;
  if (!gueltig && (call.openingLine != null || call.openingLineSha256 != null)) {
    console.warn(
      `[opening-line] veraendert call=${call.id} - gespeicherte Zeile passt nicht ` +
        `zum Annahme-Hash, deterministischer Rueckfall greift`,
    );
  }
  return bridgedObjective(call.goal, locale) ?? locale.openingReasonFallback;
}

export function ownerOpeningLine({ call, locale }) {
  const reason = verifiedOpeningLine({ call, locale });
  return hashGueltig(call) ? call.openingLine : composedOpeningLine(reason, locale);
}
