// P8 (PLAN-CONVERSATION-QUALITY-V2): aus src/claude.js hierher gezogen (reiner Move,
// Verhalten unveraendert). EINE Stelle, die den Verbrauch EINER Modellantwort auf
// beide Kosten-Achsen bucht: Live-Budget-Bucket (Regel 1) und - nur bei PAYMENT_ENABLED
// - den Stripe-Ledger. Der Pre-Call-Briefing-Aufruf (src/precall-briefing.js) hat noch
// KEINEN call (er laeuft vor store.createCall) - deshalb nimmt bookTokenUsage
// tenantId/callId einzeln entgegen statt eines call-Objekts.
//
// AL-P9: bookEstimatedTokenUsage bucht NUR die Live-Budget-Achse, nicht beide - fuer
// GESCHAETZTEN Verbrauch eines abgebrochenen Aufrufs (siehe dort).
import { config } from "./config.js";
import * as store from "./store.js";
import { USAGE_EVENT_KIND } from "./store/defaults.js";
import { aiCostCents, tokenCostMicroCents } from "./store/state-ops.js";

// L3: tatsaechlich verarbeitete Input-Token EINES Aufrufs ueber ALLE Eingabe-Preisklassen
// (llm/ports.js LlmTokenUsage). Mit Prompt-Caching traegt die ungecachte Sorte nur den
// Rest; der gecachte Praefix steht in den beiden Cache-Sorten. Summe = voller Umfang ->
// Budget-Gate (Regel 1) und Stripe-Meter zaehlen weiter den vollen Verbrauch (fail-safe:
// NIE weniger als ohne Caching). Ohne Cache sind die beiden Cache-Sorten 0 -> identisch
// zur ungecachten Zahl.
function inputTokensOf(usage) {
  return usage.inputUncachedTokens + usage.inputCacheWriteTokens + usage.inputCacheReadTokens;
}

// AI-Token-Meter EINES Modell-Aufrufs (P6b3, Meter 3). NUR im Metering-Pfad
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
    // KV-P6: derselbe ungerundete Betrag, den trackUsage (bookTokenUsage, oben) fuer
    // dieselben tokens/config.llm in costMicroCentsRem fortschreibt - EINE Preisformel
    // (tokenCostMicroCents), nicht zwei unabhaengige Rundungen.
    costMicroCents: tokenCostMicroCents(tokens, config.llm),
  });
}

// Verbrauchs-Tripel EINER Modellantwort in der Form, die beide Kosten-Achsen erwarten:
// Tokens inkl. Cache-Anteil (inputTokensOf) + die Modell-ID, unter deren Preisstaffel
// gebucht wird (P7a). Die ID kommt aus der Verbrauchsform selbst - EINE Quelle (G5);
// welche ID ein Anbieter dort meldet und warum, begruendet sein Adapter
// (llm/ports.js LlmTokenUsage.billingModelId). Reine Funktion.
function billedTokens(usage) {
  return {
    inputTokens: inputTokensOf(usage),
    outputTokens: usage.outputTokens,
    model: usage.billingModelId,
  };
}

// Bucht den Verbrauch EINER Modellantwort auf BEIDE Kosten-Achsen: den Live-
// Budget-Bucket (Regel 1) und - nur bei PAYMENT_ENABLED - den Stripe-Ledger. EINE
// Stelle (G5) fuer ALLE drei Aufrufer (agentTurn, summarizeCall in claude.js UND
// fetchPrecallBriefing in precall-briefing.js). Reihenfolge (trackUsage vor
// meterAiTokens) unveraendert. Nebeneffekte im Namen (N7).
// KV-P1: diese Buchung ist die Zeile ai_token der Kosten-Landkarte
// (src/billing/cost-ledger-map.js).
export function bookTokenUsage({ tenantId, callId, usage }) {
  const tokens = billedTokens(usage);
  store.trackUsage(tenantId, tokens, config.llm);
  meterAiTokens({ tenantId, callId, tokens });
}

// AL-P9: GESCHAETZTER Verbrauch eines ABGEBROCHENEN Modell-Aufrufs (Timeout /
// erschoepfte Retries). Bucht bewusst NUR die Live-Budget-Achse (Regel 1: das Gate darf
// nie 0 sehen, wo Token geflossen sein koennen) und NICHT den Stripe-Ledger: eine
// Schaetzung ist kein Kundenbeleg, und der Kunde hat kein Ergebnis bekommen.
// Unterbuchung im Ledger ist Umsatzverlust bei uns, kein Schutzverlust. Nebeneffekt im
// Namen (N7); der Aufrufer entscheidet, OB gebucht wird, diese Stelle nur WOHIN.
export function bookEstimatedTokenUsage({ tenantId, usage }) {
  store.trackUsage(tenantId, billedTokens(usage), config.llm);
}

// AL-P9/AL-P7: pessimistische Zeichen-je-Token-Annahme (G25). Deutscher Text liegt beim
// Anthropic-Tokenizer bei rund 3,5-4 Zeichen je Token; 3 rundet bewusst nach oben.
const ESTIMATE_CHARS_PER_TOKEN = 3;

// Deterministische, bewusst PESSIMISTISCHE Obergrenze eines ABGEBROCHENEN Modell-
// Aufrufs aus zwei bekannten Groessen: Prompt-Laenge und harter Ausgabe-Deckel. EINE
// Quelle (G5) fuer den Briefing-Abbruch (AL-P9) und den Stream-Abriss (AL-P7).
// Ueberbuchung ist die etablierte Fehlerrichtung (priceForModel -> teuerste Rate), eine
// 0-Buchung waere ein Loch im Budget-Gate (Regel 1). Liefert eine vollstaendige
// LlmTokenUsage mit estimated:true - alle Eingabe-Token auf der teuersten Sorte, wie es
// die Notfall-Regel des Vertrags vorsieht (llm/ports.js). Rein (N7).
export function estimatedAbortUsage({ promptChars, maxTokens, billingModelId }) {
  return {
    inputUncachedTokens: Math.ceil(promptChars / ESTIMATE_CHARS_PER_TOKEN),
    inputCacheWriteTokens: 0,
    inputCacheReadTokens: 0,
    outputTokens: maxTokens,
    estimated: true,
    billingModelId,
  };
}

// AL-P10: Gebuehr der serverseitigen Vorab-Recherche. Anthropic rechnet web_search PRO
// SUCHE ab; die Suchen tauchen in input_tokens/output_tokens NICHT auf - ohne diesen
// Posten waere das Budget-Gate (Regel 1) an dieser Stelle blind.
//
// Bucht bewusst NUR die Live-Budget-Achse, NICHT den Stripe-Ledger: usage_event kennt
// kein research-kind, und ein neues kind zoege den kompletten Stripe-Meter-Pfad in eine
// Phase, die ihn nicht braucht. Unterbuchung im Ledger ist Umsatzverlust bei uns, kein
// Schutzverlust (dieselbe Abwaegung wie bookEstimatedTokenUsage, AL-P9).
//
// searches = 0 -> No-Op (kein Muell-Beleg, keine 0-Buchung im Log). Nebeneffekt im
// Namen (N7); der Aufrufer entscheidet OB, diese Stelle nur WOHIN.
// KV-P1: diese Buchung ist (zusammen mit bookLookupSearchFee darunter) die Zeile
// research_fee der Kosten-Landkarte (src/billing/cost-ledger-map.js).
export function bookResearchSearchFee({ tenantId, searches }) {
  if (!searches) return;
  store.addResearchFeeCostCents(tenantId, searches * config.research.researchSearchFeeCents);
}

// AL-P10b: Gebuehr EINER In-Call-Suche (Exa, Anbieter seit AL-P10c). Eigene benannte
// Funktion statt eines Flags an bookResearchSearchFee, weil es eine ANDERE Achse mit
// eigenem Preis ist (N4: der Name sagt, was bezahlt wird). Wie dort bewusst NUR die
// Live-Budget-Achse, NICHT der Stripe-Ledger (usage_event kennt kein research-kind); Unterbuchung im Ledger ist
// Umsatzverlust bei uns, kein Schutzverlust.
//
// Der Aufrufer bucht VOR dem Absenden: eine ausgeloeste Suche ist berechnet, auch wenn
// die Antwort nie ankommt (Regel 1 - nie 0, wo Geld geflossen sein kann). Derselbe
// Store-Op wie die Vorab-Recherche - es ist dieselbe Cent-Achse, ein zweiter Op waere ein
// zweiter Loeschpfad ohne Gewinn. Nebeneffekt im Namen (N7).
export function bookLookupSearchFee({ tenantId }) {
  store.addResearchFeeCostCents(tenantId, config.research.lookupSearchFeeCents);
}
