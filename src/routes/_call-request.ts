import { SUPPORTED_LANGUAGES } from "../i18n/locales.ts";

export const UNSUPPORTED_LANGUAGE = "unsupported_language";

export const unsupportedLanguageBody = (): { error: string; code: string; supported: readonly string[] } => ({
  error: `${UNSUPPORTED_LANGUAGE}: language must be one of ${SUPPORTED_LANGUAGES.join(", ")}`,
  code: UNSUPPORTED_LANGUAGE,
  supported: SUPPORTED_LANGUAGES,
});
