// Neutrale Wahl des Sprachmodell-ANBIETERS - EIN Enum, pro Adapter uebersetzt.
// Muster: telephony/stt-profile.js. Rein: kein IO, kein config-Import (config.js
// importiert dieses Modul, nicht umgekehrt - sonst Zyklus ueber llm/registry.js).
export const LLM_PROVIDER = Object.freeze({ ANTHROPIC: "anthropic", DEEPSEEK: "deepseek" });

// EINE Quelle des Defaults: der Env-Fallback in config.js liest ihn hier.
export const DEFAULT_LLM_PROVIDER = LLM_PROVIDER.ANTHROPIC;

// EINE Quelle der gueltigen Menge: enumEnv (config.js) und die Diagnose der Registry.
export const LLM_PROVIDER_VALUES = Object.freeze(Object.values(LLM_PROVIDER));

// FW2: der Ausweich-Anbieter, sofern er ueberhaupt ausweichen KANN. Leerer Rueckgabewert
// heisst "Funktion aus" - ungesetzt ODER identisch mit dem Primaeranbieter (dann gibt es
// nichts, wohin man ausweichen koennte; der Boot meldet das als Konfig-Warnung).
export function usableFallbackProvider({ provider, fallback }) {
  if (!fallback) return "";
  if (fallback === provider) return "";
  return fallback;
}
