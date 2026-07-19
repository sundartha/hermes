// P8 (PLAN-CONVERSATION-QUALITY-V2): aus src/claude.js hierher gezogen (reiner Move,
// Verhalten unveraendert). EINE Stelle, die den Verbrauch EINER Anthropic-Antwort auf
// beide Kosten-Achsen bucht: Live-Budget-Bucket (Regel 1) und - nur bei PAYMENT_ENABLED
// - den Stripe-Ledger. Der Pre-Call-Briefing-Aufruf (src/precall-briefing.js) hat noch
// KEINEN call (er laeuft vor store.createCall) - deshalb nimmt bookTokenUsage
// tenantId/callId einzeln entgegen statt eines call-Objekts.
import { config } from "./config.js";
import * as store from "./store.js";
import { USAGE_EVENT_KIND } from "./store/defaults.js";
import { aiCostCents } from "./store/state-ops.js";

// L3: tatsaechlich verarbeitete Input-Token EINES Anthropic-Aufrufs inkl. Cache. Mit
// Prompt-Caching zaehlt usage.input_tokens nur den UNGECACHTEN Rest; der gecachte
// Praefix erscheint separat als cache_creation_/cache_read_input_tokens. Summe =
// voller Umfang -> Budget-Gate (Regel 1) und Stripe-Meter zaehlen weiter den vollen
// Verbrauch (fail-safe: NIE weniger als ohne Caching). Felder fehlen ohne Cache
// (summarizeCall ohne Tools, Praefix < Modell-Minimum) -> identisch zu input_tokens.
function inputTokensOf(usage) {
  return (
    usage.input_tokens +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0)
  );
}

// AI-Token-Meter EINES Anthropic-Aufrufs (P6b3, Meter 3). NUR im Metering-Pfad
// (PAYMENT_ENABLED) - der Nebeneffekt (recordUsageEvent) steht im Namen. Laeuft
// PARALLEL zum trackUsage-Live-Gate (getrennte Quellen, kein Doppelzaehlen):
// trackUsage fuettert den Budget-Bucket, dieser Meter den Stripe-Ledger. quantity =
// Gesamt-Tokens, costCents aus derselben Preisformel (aiCostCents, G5). callId
// verknuepft den Beleg, ueberlebt aber ein Call-Erase (usage_event ohne call-FK);
// beim Briefing-Aufruf (noch kein Call) bleibt callId null (state-ops-Default).
function meterAiTokens({ tenantId, callId, tokens }) {
  if (!config.billing.paymentEnabled) return;
  store.recordUsageEvent({
    tenantId,
    callId,
    kind: USAGE_EVENT_KIND.AI_TOKEN,
    quantity: tokens.inputTokens + tokens.outputTokens,
    costCents: aiCostCents(tokens, config.llm),
  });
}

// Verbrauchs-Tripel EINER Anthropic-Antwort in der Form, die beide Kosten-Achsen
// erwarten: Tokens inkl. Cache-Anteil (inputTokensOf) + die Modell-ID, unter deren
// Preisstaffel gebucht wird (P7a).
//
// Modell-Quelle ist die ANGEFORDERTE ID - dieselbe, die an llm.complete geht -, NICHT
// resp.model: Anthropic antwortet mit der aufgeloesten, DATIERTEN Snapshot-ID, die in
// der Preistabelle nicht steht. Jeder Turn liefe damit in den Fail-closed-Zweig
// (teuerste Rate) und das Budget waere systematisch zu frueh erschoepft. Reine Funktion.
function billedTokens(usage, model) {
  return { inputTokens: inputTokensOf(usage), outputTokens: usage.output_tokens, model };
}

// Bucht den Verbrauch EINER Anthropic-Antwort auf BEIDE Kosten-Achsen: den Live-
// Budget-Bucket (Regel 1) und - nur bei PAYMENT_ENABLED - den Stripe-Ledger. EINE
// Stelle (G5) fuer ALLE drei Aufrufer (agentTurn, summarizeCall in claude.js UND
// fetchPrecallBriefing in precall-briefing.js). Reihenfolge (trackUsage vor
// meterAiTokens) unveraendert. Nebeneffekte im Namen (N7).
export function bookTokenUsage({ tenantId, callId, usage, model }) {
  const tokens = billedTokens(usage, model);
  store.trackUsage(tenantId, tokens, config.llm);
  meterAiTokens({ tenantId, callId, tokens });
}
