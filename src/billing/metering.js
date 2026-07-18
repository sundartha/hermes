// Metering: Voice-Minuten-/Nummern-Meter (P6b3) + Budget-Reconcile (outbound-p1c).
// Reine Verschiebung aus server.js (Server-Slim P1). Die Factory schliesst store+config;
// die Kosten-/Kind-Quellen (tariffCentsPerMin, holdAmountForCountry, USAGE_EVENT_KIND)
// importiert das Modul selbst (EINE Quelle je, G5). Die paymentEnabled-Gating-Bedingung liegt
// beim AUFRUFER (finishCall / Provisioning-Drain), NICHT hier: reconcileOutboundVoiceBudget
// laeuft immer, recordVoiceMinuteMeter / recordNumberMonthMeter nur im Payment-Pfad.
import { USAGE_EVENT_KIND } from "../store/defaults.js";
import { tariffCentsPerMin } from "../telephony/outbound-gates.js";
import { holdAmountForCountry } from "../telephony/provisioning-geo.js";

const MS_PER_MINUTE = 60 * 1000;

export function makeMetering({ store, config }) {
  // Abgerechnete Voice-Minuten EINES Calls (ceil ab answeredAt bis endedAt, Provider-
  // Minutentakt). Nie beantwortet -> 0. EINE Minuten-Quelle (G5) fuer Stripe-Voice-Meter
  // UND Budget-Reconcile.
  function voiceMinutesOf(call) {
    if (!call.answeredAt || !call.endedAt) return 0;
    return Math.ceil((new Date(call.endedAt) - new Date(call.answeredAt)) / MS_PER_MINUTE);
  }

  // Voice-Minuten-Meter EINES beendeten Calls (P6b3, Meter 2). NUR im Metering-Pfad
  // (PAYMENT_ENABLED, vom Aufrufer gegated) - Nebeneffekt (recordUsageEvent) im Namen.
  // 0 Minuten -> kein Event (kein Null-Beleg). Kosten-Cents aus dem Ziel-Tarif
  // (tariffCentsPerMin, EINE Kosten-Quelle G5) x Minuten.
  function recordVoiceMinuteMeter(call) {
    const minutes = voiceMinutesOf(call);
    if (minutes <= 0) return;
    store.recordUsageEvent({
      tenantId: call.tenantId,
      callId: call.id,
      kind: USAGE_EVENT_KIND.VOICE_MINUTE,
      quantity: minutes,
      costCents: minutes * tariffCentsPerMin(call.to),
    });
  }

  // Reconcile (outbound-p1c, Kosten-Achse, D1): bucht die IST-Voice-Minuten eines beendeten
  // OUTBOUND-Calls (Minuten x Ziel-Tarif) in den Budget-Bucket des Tenants - so sieht der
  // Budget-Gate + die Vorab-Reservierung endlich die Carrier-Minuten. IMMER (auch ohne
  // PAYMENT_ENABLED, im owner-only-Interim). Inbound byte-identisch (kein Budget-Abzug).
  // Nie beantwortet -> 0 Minuten -> kein Abzug. Nebeneffekt (Store-Mutation) im Namen (N7).
  function reconcileOutboundVoiceBudget(call) {
    if (call.direction !== "outbound") return;
    const minutes = voiceMinutesOf(call);
    if (minutes <= 0) return;
    store.addVoiceUsageCostCents(call.tenantId, minutes * tariffCentsPerMin(call.to));
  }

  // number_month-Meter EINER neu aktivierten Nummer (P6b3, Meter 1). NUR im Metering-
  // Pfad (PAYMENT_ENABLED, vom Aufrufer gegated) - der Nebeneffekt steht im Namen.
  // number ist undefined, wenn der Job uebersprungen wurde (Re-Drain) -> kein Event.
  // callId bewusst null (Nummern-Meter hat keinen Call). costCents = der per-Land-Setup-Tarif
  // (P9): MUSS denselben Wert nutzen wie der Hold, sonst driftet das Ledger vom real
  // gehaltenen/gecaptureten Betrag (Mini-R3 im usage_event). Land ohne eigenen Tarif / DE
  // -> numberSetupFeeCents (byte-identisch).
  function recordNumberMonthMeter(number) {
    if (!number) return;
    store.recordUsageEvent({
      tenantId: number.tenantId,
      kind: USAGE_EVENT_KIND.NUMBER_MONTH,
      quantity: 1,
      costCents: holdAmountForCountry(number.country, config.billing.numberSetupFeeCents),
    });
  }

  return {
    voiceMinutesOf,
    recordVoiceMinuteMeter,
    reconcileOutboundVoiceBudget,
    recordNumberMonthMeter,
  };
}
