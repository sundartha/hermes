// Metering: Voice-Minuten-/Nummern-Meter (P6b3) + Budget-Reconcile (outbound-p1c).
// Reine Verschiebung aus server.js (Server-Slim P1). Die Factory schliesst NUR den store -
// die Monatsmiete kommt seit P5 aus dem Nummern-Datensatz, nicht mehr aus config; die
// Kosten-/Kind-Quellen (tariffCentsPerMin, USAGE_EVENT_KIND) und die Faelligkeits-Regel
// (numbersDueForMonthMeter) importiert das Modul selbst (EINE Quelle je, G5). Die
// paymentEnabled-Gating-Bedingung liegt beim AUFRUFER (finishCall / Provisioning-Drain /
// Monatsmiete-Ausloeser), NICHT hier: reconcileOutboundVoiceBudget laeuft immer,
// recordVoiceMinuteMeter / recordNumberMonthMeter nur im Payment-Pfad.
import { USAGE_EVENT_KIND } from "../store/defaults.js";
import { numbersDueForMonthMeter } from "../store/state-ops.js";
import { tariffCentsPerMin } from "../telephony/outbound-gates.js";

const MS_PER_MINUTE = 60 * 1000;

// Abgerechnete Voice-Minuten EINES Calls (ceil ab answeredAt bis endedAt, Provider-
// Minutentakt). Nie beantwortet -> 0. EINE Minuten-Quelle (G5) fuer Stripe-Voice-Meter,
// Budget-Reconcile UND - seit LCT P5 - den Drift-Waechter: der gemessene Minutensatz
// muss gegen DIESELBE Minutendefinition rechnen, gegen die gebucht wurde, sonst
// vergleicht der Waechter zwei verschiedene Groessen.
// Auf Modulebene, weil die Funktion store/config NICHT braucht (rein) und ein zweiter
// Nachbau in cost-calibration.js eine Kopie derselben Rundungsregel waere.
export function voiceMinutesOf(call) {
  if (!call.answeredAt || !call.endedAt) return 0;
  const minutes = Math.ceil((new Date(call.endedAt) - new Date(call.answeredAt)) / MS_PER_MINUTE);
  // Wurzel-Normalisierung (D7): ein unbrauchbares answeredAt/endedAt ergibt NaN, und
  // NaN <= 0 ist false - beide Aufrufer-Riegel (minutes <= 0) liessen es durch und
  // NaN*Tarif landete im Geld-Bucket. Hier auf 0 = "nie beantwortet" normalisiert, damit
  // beide Riegel BYTE-IDENTISCH bleiben und keine zweite Kopie derselben Pruefung
  // entsteht (G5). Number.isFinite statt isBookableCents: das ist die MINUTEN-Achse,
  // nicht die Cent-Achse - der Cent-Riegel sitzt eine Schicht tiefer in state-ops.
  return Number.isFinite(minutes) ? minutes : 0;
}

// Minutensatz DIESES Legs (P5, Herkunfts-Achse). Die eigene DID des Tenants steht
// richtungsabhaengig an verschiedenen Enden: outbound waehlen WIR (call.from), inbound wird
// die DID angewaehlt (call.to). Inbound hat kein fremdes Ziel-Leg - der Satz haengt am Land
// der EIGENEN DID, sie steht deshalb an beiden Enden (O3b/B2: Beleg zum Satz des DID-Landes,
// nie zum Auslands-Worst-Case des Anrufers - aber auch nie pauschal Inland: eine US-DID
// bekommt den Default-Satz). Unbekannte Richtung faellt in den outbound-Zweig und ohne
// Herkunft fail-closed auf den teuersten Satz.
export function callTariffCentsPerMin(call) {
  if (call.direction === "inbound") return tariffCentsPerMin(call.to, call.to);
  return tariffCentsPerMin(call.to, call.from);
}

export function makeMetering({ store }) {
  // Voice-Minuten-Meter EINES beendeten Calls (P6b3, Meter 2). NUR im Metering-Pfad
  // (PAYMENT_ENABLED, vom Aufrufer gegated) - Nebeneffekt (recordUsageEvent) im Namen.
  // 0 Minuten -> kein Event (kein Null-Beleg). Kosten-Cents aus dem Leg-Tarif (Ziel UND
  // Herkunft, callTariffCentsPerMin - EINE Kosten-Quelle G5) x Minuten.
  function recordVoiceMinuteMeter(call) {
    const minutes = voiceMinutesOf(call);
    if (minutes <= 0) return;
    store.recordUsageEvent({
      tenantId: call.tenantId,
      callId: call.id,
      kind: USAGE_EVENT_KIND.VOICE_MINUTE,
      quantity: minutes,
      costCents: minutes * callTariffCentsPerMin(call),
    });
  }

  // Reconcile (outbound-p1c, Kosten-Achse, D1): bucht die IST-Voice-Minuten eines beendeten
  // OUTBOUND-Calls (Minuten x Leg-Tarif: Ziel UND Herkunft) in den Budget-Bucket des
  // Tenants - so sieht der Budget-Gate + die Vorab-Reservierung endlich die Carrier-Minuten. IMMER (auch ohne
  // PAYMENT_ENABLED, im owner-only-Interim). Inbound byte-identisch (kein Budget-Abzug).
  // Nie beantwortet -> 0 Minuten -> kein Abzug. Nebeneffekt (Store-Mutation) im Namen (N7).
  function reconcileOutboundVoiceBudget(call) {
    if (call.direction !== "outbound") return;
    const minutes = voiceMinutesOf(call);
    if (minutes <= 0) return;
    // LCT P2: EIN Ausdruck, EIN Wert - gebucht und persistiert wird dieselbe Zahl im selben
    // Schritt. Der Schaetzbetrag DARF spaeter NICHT aus tariffCentsPerMin rekonstruiert
    // werden: P4b senkt den Tarif, und P3 gleicht mit COST_TRUING_DELAY_MINUTES Verzug ab -
    // der ENV-Wechsel faellt genau in dieses Fenster. Eine gegen den NEUEN Tarif gerechnete
    // Korrektur erstattete real ausgegebenes Geld zurueck und oeffnete den geteilten
    // Lebenszeit-Topf wieder (Kapitel 4 des Plans).
    //
    // Reihenfolge ist Absicht: erst buchen, dann den Bezugswert festhalten. Beide Schritte
    // sind synchrone Spiegel-Mutationen ohne IO dazwischen; die Richtung im Zweifel ist die,
    // die MEHR gebucht laesst (fehlender Estimate -> P4 korrigiert gar nicht, fail-closed).
    const estimatedCostCents = minutes * callTariffCentsPerMin(call);
    store.addVoiceUsageCostCents(call.tenantId, estimatedCostCents);
    store.recordCallEstimatedCostCents(call.id, estimatedCostCents);
  }

  // Monatsmiete EINER Nummer in GANZZAHL Cents (G26: nie Float-Euro), oder null ohne
  // gelernten Preis. VERBINDLICH (Owner 2026-07-27): NUR der beim Kauf uebernommene
  // Provider-Preis am Nummern-Datensatz (P4/GAP-11) ist die Miete. KEIN Fallback auf die
  // Einrichtungsgebuehr, KEIN NUMBER_MONTHLY_COST_CENTS, KEINE Schaetzung aus der ersten
  // Buchung - jede dieser drei Quellen ist ausdruecklich verboten. Reine Funktion.
  function monthlyRentCents(number) {
    return Number.isInteger(number.monthlyCostCents) ? number.monthlyCostCents : null;
  }

  // number_month-Meter EINER Nummer (P6b3 Meter 1, seit P5 wiederkehrend). NUR im
  // Metering-Pfad (PAYMENT_ENABLED, vom Aufrufer gegated) - Nebeneffekt im Namen (N7).
  // nowIso ist DIESELBE Uhr, mit der die Faelligkeit geprueft wurde: Pruefung und Beleg
  // muessen im selben Kalendermonat liegen, sonst faellt ein Monat zwischen zwei Uhren
  // durch. numberId ist der Idempotenz-Anker (ein Beleg je Nummer und Monat), callId
  // bleibt null (Nummern-Meter hat keinen Call). number undefined (uebersprungener
  // Re-Drain) -> kein Event. Ohne gelernten Preis wird NICHT gebucht (fail-closed, s.
  // monthlyRentCents). Liefert true, wenn wirklich ein Beleg entstand.
  function recordNumberMonthMeter(number, nowIso) {
    if (!number) return false;
    const costCents = monthlyRentCents(number);
    if (costCents === null) return false;
    store.recordUsageEvent({
      tenantId: number.tenantId,
      numberId: number.id,
      kind: USAGE_EVENT_KIND.NUMBER_MONTH,
      quantity: 1,
      costCents,
      occurredAt: nowIso,
    });
    return true;
  }

  // GAP-06: bucht die im Kalendermonat von nowIso noch OFFENEN Monatsmieten. Der
  // Idempotenz-Riegel liegt vollstaendig in numbersDueForMonthMeter (EINE Regel, G5) -
  // diese Funktion bucht nur, was faellig ist, und ist damit unter BEIDEN Ausloesern
  // (Abo-Verlaengerung, stuendlicher Sweep) zusammen sicher. Ein Fehler an EINER Nummer
  // beendet den Lauf NICHT (Spec-Invariante); geloggt wird PII-frei (interne numberId,
  // nie e164). Den State reicht der Aufrufer herein, er haelt auch den Lock (Vertrag wie
  // billing/meter.js). Liefert die Zaehlung fuer die EINE Log-Zeile des Aufrufers.
  //
  // BEWUSSTE ABWAEGUNG: der Schreibpfad bleibt EINER - store.recordUsageEvent, das je
  // Beleg selbst persistiert. Ein zweiter, ops-direkter Schreibpfad nur zur Einsparung
  // von Flushes waere eine Kopie derselben Buchungslogik (G5/S2). Die Schleife laeuft je
  // Nummer EINMAL PRO MONAT, nicht stuendlich: nach dem ersten erfolgreichen Lauf ist
  // nichts mehr faellig. Nebeneffekt im Namen (N7).
  function recordDueNumberMonthMeters(s, { nowIso, tenantId = null }) {
    const faellige = numbersDueForMonthMeter(s, { nowIso, tenantId });
    let gebucht = 0;
    let ohnePreis = 0;
    let fehler = 0;
    for (const number of faellige) {
      try {
        if (recordNumberMonthMeter(number, nowIso)) gebucht++;
        else ohnePreis++;
      } catch (err) {
        fehler++;
        console.error(`[number-month] Beleg fehlgeschlagen number=${number.id}:`, err.message);
      }
    }
    return { faellig: faellige.length, gebucht, ohnePreis, fehler };
  }

  return {
    voiceMinutesOf,
    recordVoiceMinuteMeter,
    reconcileOutboundVoiceBudget,
    recordNumberMonthMeter,
    recordDueNumberMonthMeters,
  };
}
