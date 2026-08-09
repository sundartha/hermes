// LLM-Registry (K21): die EINE Stelle, die den aktiven Sprachmodell-Anbieter waehlt.
// Muster: telephony/registry.js - ein zweiter Adapter wird HIER an einer Datenstruktur
// eingetragen, nicht an Ternaries im Fachcode.
//
// Die WAHL kommt aus dem config-SINGLETON, nicht aus einem uebergebenen config-Objekt:
// der Anbieter ist eine prozessweite Tatsache (Muster DEFAULT_PROVIDER, telephony). Die
// Resilienz-ZAHLEN sind es nicht - precall-briefing.js baut bewusst eine zweite
// createLlmClient-Instanz mit eigenem Timeout/Retry, aber nie mit einem zweiten Anbieter.
//
// DURCHREICH-REGEL: createLlmProvider reicht die Optionen unveraendert an den Adapter
// weiter. Test-Seam-Namen (messagesCreate/messagesStream bei Anthropic,
// chatCompletionsFetch bei DeepSeek) gehoeren dem jeweiligen Adapter; ein Adapter
// ignoriert, was er nicht kennt - dieselbe Regel wie fuer unbekannte Request-Schluessel.
import { config } from "../config.js";
import { LLM_PROVIDER, LLM_PROVIDER_VALUES } from "./provider.js";
import { anthropicErrors, createAnthropicProvider } from "./adapters/anthropic.js";
import { createDeepseekProvider, deepseekErrors } from "./adapters/deepseek.js";

const ADAPTERS = Object.freeze({
  [LLM_PROVIDER.ANTHROPIC]: Object.freeze({
    create: createAnthropicProvider,
    errors: anthropicErrors,
    // LAZY (Arrow): der Schluessel wird beim AUFRUF gelesen, nicht zur Import-Zeit
    // (P15; Muster VOICE_RENDERER in telephony/registry.js).
    apiKey: () => config.llm.anthropicApiKey,
  }),
  [LLM_PROVIDER.DEEPSEEK]: Object.freeze({
    create: createDeepseekProvider,
    errors: deepseekErrors,
    apiKey: () => config.llm.deepseekApiKey,
  }),
});

// Object.hasOwn statt ADAPTERS[id]: ein Env-Wert "__proto__" traefe sonst
// Object.prototype und lieferte ein Objekt ohne create() (Muster priceForModel,
// state-ops.js). Wirft fail-closed und nennt Wert + gueltige Menge - unerreichbar,
// solange enumEnv (config.js) den Boot vorher abbricht, aber die Registry verlaesst sich
// nicht darauf (Muster pick(), telephony/registry.js). Nie ein Secret in der Meldung.
function adapterEntry() {
  const provider = config.llm.llmProvider;
  if (!Object.hasOwn(ADAPTERS, provider))
    throw new Error(
      `LLM_PROVIDER '${provider}' nicht unterstuetzt (gueltig: ${LLM_PROVIDER_VALUES.join("|")})`,
    );
  return ADAPTERS[provider];
}

/** @returns {import("./ports.js").LlmProvider} */
export function createLlmProvider(options = {}) {
  const entry = adapterEntry();
  return entry.create({ ...options, apiKey: entry.apiKey() });
}

// Die Fehler-Klassifikation des AKTIVEN Anbieters, OHNE einen Client zu bauen: die beiden
// Leser im Seam (isTransient, isProviderBillingError) sind Modul-Funktionen ohne Instanz,
// und ein Client je Fehlerfrage waere absurd.
/** @returns {import("./ports.js").LlmErrorClassification} */
export function activeLlmErrors() {
  return adapterEntry().errors;
}
