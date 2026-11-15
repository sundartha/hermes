import { SUPPORTED_LANGUAGES } from "../i18n/locales.js";

export const UNSUPPORTED_LANGUAGE = "unsupported_language";
export const LANGUAGE_UNAVAILABLE = "language_unavailable";

export const unsupportedLanguageBody = (): { error: string; code: string; supported: readonly string[] } => ({
  error: `${UNSUPPORTED_LANGUAGE}: language must be one of ${SUPPORTED_LANGUAGES.join(", ")}`,
  code: UNSUPPORTED_LANGUAGE,
  supported: SUPPORTED_LANGUAGES,
});

export const languageUnavailableBody = (): { error: string; code: string } => ({
  error:
    `${LANGUAGE_UNAVAILABLE}: this deployment cannot separate the spoken language from the ` +
    "mandatory AI disclosure - omit language",
  code: LANGUAGE_UNAVAILABLE,
});
