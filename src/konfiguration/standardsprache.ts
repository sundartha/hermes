export const STARTSPRACHE = "de";

export let DEFAULT_LANGUAGE: "en" | "de" = "en";

export function setWorldDefaultLanguageEnabled(enabled: boolean): void {
  DEFAULT_LANGUAGE = enabled ? "en" : "de";
}
