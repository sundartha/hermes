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
import { aiCostCents, inputTokensOf, tokenCostMicroCents } from "./store/state-ops.js";

// AI-Token-Meter EINES Modell-Aufrufs (P6b3, Meter 3). NUR im Metering-Pfad
// (PAYMENT_ENABLED) - der Nebeneffekt (recordUsageEvent) steht im Namen. Laeuft
// PARALLEL zum trackUsage-Live-Gate (getrennte Quellen, kein Doppelzaehlen):
// trackUsage fuettert den Budget-Bucket, dieser Meter den Stripe-Ledger. quantity ist die
// Stripe-MENGE (Gesamt-Tokens), NICHT die Preisbasis - der Preis steht daneben in
// costCents/costMicroCents und wird seit B4a je Token-Sorte gerechnet (G5). callId
// verknuepft den Beleg, ueberlebt aber ein Call-Erase (usage_event ohne call-FK);
// beim Briefing-Aufruf (noch kein Call) bleibt callId null (state-ops-Default).
function meterAiTokens({ tenantId, callId, tokens }) {
  if (!config.billing.paymentEnabled) return;
  store.recordUsageEvent({
    tenantId,
    callId,
    kind: USAGE_EVENT_KIND.AI_TOKEN,
    quantity: inputTokensOf(tokens) + tokens.outputTokens,
    costCents: aiCostCents(tokens, config.llm),
    // KV-P6: derselbe ungerundete Betrag, den trackUsage (bookTokenUsage, oben) fuer
    // dieselben tokens/config.llm in costMicroCentsRem fortschreibt - EINE Preisformel
    // (tokenCostMicroCents), nicht zwei unabhaengige Rundungen.
    costMicroCents: tokenCostMicroCents(tokens, config.llm),
  });
}

// Verbrauchsform EINER Modellantwort, wie beide Kosten-Achsen sie erwarten: die VIER
// Token-Sorten (llm/ports.js) + die Modell-ID, unter deren Preisstaffel gebucht wird
// (P7a). Seit B4a wird hier NICHT mehr gefaltet - die Preisrechnung braucht die Sorten
// getrennt (jede hat ihre eigene Rate); die Summe bildet, wer eine Summe braucht
// (inputTokensOf). Die ID kommt aus der Verbrauchsform selbst - EINE Quelle (G5); welche
// ID ein Anbieter dort meldet und warum, begruendet sein Adapter (llm/ports.js
// LlmTokenUsage.billingModelId). `estimated` bleibt bewusst draussen: die Buchung
// entscheidet nichts daran, und ein durchgereichtes Feld ohne Leser waere Vorratshaltung.
// Reine Funktion.
function billedTokens(usage) {
  return {
    inputUncachedTokens: usage.inputUncachedTokens,
    inputCacheWriteTokens: usage.inputCacheWriteTokens,
    inputCacheReadTokens: usage.inputCacheReadTokens,
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
// LlmTokenUsage mit estimated:true - alle Eingabe-Token auf der UNGECACHTEN Sorte, wie es
// die Notfall-Regel des Vertrags vorsieht (llm/ports.js). Sie ist NICHT die teuerste: die
// 5m-Cache-Schreibrate liegt in jeder Zeile der Preistabelle darueber; das Gegengewicht
// ist ESTIMATE_CHARS_PER_TOKEN = 3 gegen real 3,5-4. Rein (N7).
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
