export const INVALID_LANGUAGE = "invalid_language";

export const invalidLanguageBody = (): { error: string; code: string } => ({
  error: `${INVALID_LANGUAGE}: language must be an ISO language code such as de, es or pt-br`,
  code: INVALID_LANGUAGE,
});
