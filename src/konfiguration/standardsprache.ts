export let DEFAULT_LANGUAGE = "en";

export function setWorldDefaultLanguageEnabled(enabled: boolean): void {
  DEFAULT_LANGUAGE = enabled ? "en" : "de";
}
