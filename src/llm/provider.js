// Neutrale Wahl des Sprachmodell-ANBIETERS - EIN Enum, pro Adapter uebersetzt.
// Muster: telephony/stt-profile.js. Rein: kein IO, kein config-Import (config.js
// importiert dieses Modul, nicht umgekehrt - sonst Zyklus ueber llm/registry.js).
export const LLM_PROVIDER = Object.freeze({ ANTHROPIC: "anthropic", DEEPSEEK: "deepseek" });

// EINE Quelle des Defaults: der Env-Fallback in config.js liest ihn hier.
export const DEFAULT_LLM_PROVIDER = LLM_PROVIDER.ANTHROPIC;

// EINE Quelle der gueltigen Menge: enumEnv (config.js) und die Diagnose der Registry.
export const LLM_PROVIDER_VALUES = Object.freeze(Object.values(LLM_PROVIDER));
