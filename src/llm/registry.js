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
//
// FW2: mit konfiguriertem Ausweich-Anbieter routet createLlmProvider je Aufruf zwischen
// ZWEI fertig gebauten Adaptern (an einer Datenstruktur, s. makeLatchRoutedProvider) -
// kein Lazy-Init (P15), keine Zusatzlatenz im Normalfall. Ohne Fallback ist das Verhalten
// byte-identisch zum Bestand (nackter Adapter, kein Routing-Wrapper).
import { config } from "../config.js";
import { LLM_PROVIDER, LLM_PROVIDER_VALUES, usableFallbackProvider } from "./provider.js";
import { anthropicErrors, createAnthropicProvider } from "./adapters/anthropic.js";
import { createDeepseekProvider, deepseekErrors } from "./adapters/deepseek.js";
import { billingBlocked, markBillingBlocked } from "./billing-latch.js";

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
function adapterEntry(provider) {
  if (!Object.hasOwn(ADAPTERS, provider))
    throw new Error(
      `LLM_PROVIDER '${provider}' nicht unterstuetzt (gueltig: ${LLM_PROVIDER_VALUES.join("|")})`,
    );
  return ADAPTERS[provider];
}

// FW2: der wirksame Ausweich-Anbieter dieses Prozesses ("" = Funktion aus).
function fallbackProviderId() {
  return usableFallbackProvider({
    provider: config.llm.llmProvider,
    fallback: config.llm.llmProviderFallback,
  });
}

// FW2: WELCHER Anbieter faehrt die NAECHSTE Anfrage. Guard-Clauses statt Ternary; ohne
// konfigurierten Fallback ist die Antwort byte-identisch zum Bestand.
function routedProviderId(nowMs) {
  const primary = config.llm.llmProvider;
  const fallback = fallbackProviderId();
  if (!fallback) return primary;
  if (!billingBlocked({ provider: primary, nowMs })) return primary;
  return fallback;
}

function buildAdapter(provider, options) {
  const entry = adapterEntry(provider);
  return entry.create({ ...options, apiKey: entry.apiKey() });
}

// FW2: EIN Port-Objekt, zwei fertig gebaute Adapter, die Wahl je Aufruf an einer Map.
// Kein Lazy-Init (P15), keine Zusatzlatenz (nie zwei Anbieter je Anfrage), und die
// Fehler-Klassifikation folgt dem TATSAECHLICH benutzten Anbieter.
function makeLatchRoutedProvider(adapterByProvider) {
  const current = () => adapterByProvider.get(routedProviderId(Date.now()));
  return {
    complete: (request) => current().complete(request),
    completeStream: (request, sink) => current().completeStream(request, sink),
    errors: {
      isTransient: (err) => current().errors.isTransient(err),
      isBillingError: (err) => current().errors.isBillingError(err),
    },
  };
}

/** @returns {import("./ports.js").LlmProvider} */
export function createLlmProvider(options = {}) {
  const primary = config.llm.llmProvider;
  const fallback = fallbackProviderId();
  const primaryAdapter = buildAdapter(primary, options);
  if (!fallback) return primaryAdapter; // Bestand, unveraendert
  return makeLatchRoutedProvider(
    new Map([
      [primary, primaryAdapter],
      [fallback, buildAdapter(fallback, options)],
    ]),
  );
}

// Die Fehler-Klassifikation des AKTIVEN Anbieters, OHNE einen Client zu bauen: die beiden
// Leser im Seam (isTransient, isProviderBillingError) sind Modul-Funktionen ohne Instanz,
// und ein Client je Fehlerfrage waere absurd.
/** @returns {import("./ports.js").LlmErrorClassification} */
export function activeLlmErrors() {
  return adapterEntry(routedProviderId(Date.now())).errors;
}

// FW2: der Guthaben-Ausfall des AKTUELL gerouteten Anbieters wird vermerkt. Ohne
// konfigurierten Fallback passiert NICHTS (Invariante "ungesetzt = byte-identisch").
// Rueckgabe null = Funktion aus; sonst das, was die Sicht-Zeile braucht.
export function latchBillingBlockedProvider(nowMs) {
  if (!fallbackProviderId()) return null;
  const blockedProvider = routedProviderId(nowMs);
  const cooldownMs = config.llm.llmBillingLatchCooldownMs;
  const freshlyLatched = markBillingBlocked({ provider: blockedProvider, nowMs, cooldownMs });
  return { blockedProvider, nextProvider: routedProviderId(nowMs), cooldownMs, freshlyLatched };
}
