// Metering: Voice-Minuten-/Nummern-Meter (P6b3) + Budget-Reconcile (outbound-p1c, seit
// KV-P2 richtungsoffen). Reine Verschiebung aus server.js (Server-Slim P1). Die Factory
// schliesst NUR den store - die Monatsmiete kommt seit P5 aus dem Nummern-Datensatz, nicht
// mehr aus config; die Kosten-/Kind-Quellen (tariffCentsPerMin, config.billing.
// voiceTariffInboundCents, KOSTENPROFIL, USAGE_EVENT_KIND) und die Faelligkeits-Regel
// (numbersDueForMonthMeter) importiert das Modul selbst (EINE Quelle je, G5). Die
// paymentEnabled-Gating-Bedingung liegt beim AUFRUFER (finishCall / Provisioning-Drain /
// Monatsmiete-Ausloeser), NICHT hier: reconcileVoiceBudget laeuft immer,
// recordVoiceMinuteMeter / recordNumberMonthMeter nur im Payment-Pfad.
import { config as defaultConfig } from "../config.js";
import { USAGE_EVENT_KIND } from "../store/defaults.js";
import { callStartAnchorMs, carrierEndMsOf, chargeAnchorsOfUsage, numbersDueForMonthMeter } from "../store/state-ops.js";
import { tariffCentsPerMin } from "../telephony/outbound-gates.js";
import { MS_PER_MINUTE } from "../utils/timer.js";
// IEL-B2: das Kostenprofil entscheidet mit ueber den Inbound-Satz (kostenarten.js ist
// import-frei - kein Zyklus in den Store-Graph).
import { KOSTENPROFIL } from "./kostenarten.js";

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

// Minutensatz DIESES Legs - die EINZIGE Funktion, die den Satz eines CALL-RECORDS
// bestimmt (Ledger, Gate, Live-Term und die guthaben-abgeleitete Notbremse lesen alle
// hier, G5). tariffCentsPerMin daneben bepreist ein GEWAEHLTES Ziel (Vorab-Reserve am
// Dial, wo es noch keinen Call-Record gibt) - fuer Outbound dieselbe Zahl, weil es
// dasselbe gewaehlte Ziel ist.
// KV-P2: Inbound hat KEIN gewaehltes Ziel. Der frueher hier gezogene Satz des eigenen
// DID-Landes war eine Notloesung und an einer US-DID der Auslands-Worst-Case (30 ct) -
// 16-fach ueber dem an KV-M1 gemessenen Ist von 1,87 US-Cent je angefangener Minute.
// Seither traegt Inbound einen eigenen, kalibrierten Satz; er wird an GENAU DIESER
// EINEN Stelle gelesen (kein zweiter Tarif-Pfad, G5).
// IEL-B2 (E3): der kalibrierte Inbound-Satz ist an einem Bein gemessen, dessen Gespraech
// UNSER Turn-Loop fuehrt. Fuehrt der ElevenLabs-Agent das Gespraech (Kostenprofil
// telnyx_inbound_el_convai), traegt das Bein die EL-Konversationskosten - es zahlt dann
// den Leg-Satz wie Outbound-EL fuer dasselbe Nummernpaar (isDomesticLeg ist symmetrisch;
// unbekannte Gegenstelle -> Default-Satz, fail-closed). Jedes andere Inbound-Profil und
// ein Bein ohne Profil bleiben beim kalibrierten Satz.
export function callTariffCentsPerMin(call) {
  if (billsCalibratedInboundRate(call)) return defaultConfig.billing.voiceTariffInboundCents;
  return tariffCentsPerMin(call.to, call.from);
}

function billsCalibratedInboundRate(call) {
  return call.direction === "inbound" && call.costProfile !== KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI;
}

// KS-P2: die bereits verstrichenen, aber noch NICHT gebuchten Minuten EINES laufenden
// Calls. Schwester von voiceMinutesOf mit DERSELBEN Rundungsregel (ceil, Provider-
// Minutentakt) - der Live-Term ist die Vorhersage genau der Buchung, die
// reconcileVoiceBudget am Call-Ende vornimmt, und darf sie nie unterschaetzen.
//
// BEWUSST ein anderer Anker als voiceMinutesOf: callStartAnchorMs nimmt answeredAt, sonst
// startedAt. Fuer einen BEENDETEN Call heisst "kein answeredAt" korrekt "nie beantwortet,
// nichts zu buchen"; fuer einen LAUFENDEN Call (verlorener Answer-Webhook, Re-Attach nach
// Instanzwechsel) hiesse dieselbe Regel "kostenlos" - der Leg laeuft real und kostet real.
//
// Zwei Randfaelle, beide fail-closed:
//   Uhr-Ruecksprung (NTP) -> negative Zeit -> 0, der Live-Term darf den Verbrauch NIE
//     unter den gebuchten Wert druecken;
//   unlesbarer Anker      -> NaN, KEIN stilles 0. Der Riegel sitzt an der Geld-Kante
//     (liveBudgetExceeded), wo jeder andere unbrauchbare Geldwert auch endet.
//
// IEL-B4 (E17): Ende = Carrier-Ende (dieselbe Funktion wie der Ende-Anker der Buchung). Ein
// ueberbrueckter Inbound-Call im Nachlauf hat keine Leitung mehr und waechst nicht weiter in
// die Tenant-Decke. Ohne Nachlauf-Marker = nowMs -> Outbound/Budget byte-identisch.
function liveVoiceMinutesOf(call, nowMs) {
  const elapsedMs = carrierEndMsOf(call, nowMs) - callStartAnchorMs(call);
  if (!Number.isFinite(elapsedMs)) return NaN;
  return Math.max(0, Math.ceil(elapsedMs / MS_PER_MINUTE));
}

// KS-P2: der Live-Term ist eine TENANT-Groesse, nicht die des rufenden Legs - die Summe
// ueber ALLE noch laufenden Calls. Call-lokal gerechnet saehe jeder Turn nur seine
// eigene Zeit; die der uebrigen N-1 Legs fiele unter den Tisch (Unterzaehlung). Die Groesse,
// die diese Luecke heute deckt, ist die Reserve - und die ist strukturell ephemer (nie
// persistiert, nie hydriert) und nach jedem Deploy 0. Eine Summe ueber den Store braucht
// dafuer weder Migration noch Boot-Hook.
//
// Der Aufrufer liefert ALLE aktiven Legs des Tenants (store.activeCallsFor, der einzige
// Produzent). KV-P2/Owner-Entscheidung 3b dreht die alte Begruendung genau um: was gebucht
// wird, MUSS live zaehlen, sonst ist der Live-Term ausgerechnet bei einer buchenden
// Kostenart blind. Keine Doppelzaehlung, weil persistEnd() den Status vor bill() von
// "active" wegschreibt (call-termination.js).
//
// Ein einzelnes NaN (unlesbarer Anker) vergiftet die Summe ABSICHTLICH und faehrt den ganzen
// Tenant fail-closed ueber die D7-Kante - nicht "der eine Call zaehlt halt 0".
export function liveVoiceSpendCents(activeCalls, nowMs) {
  return activeCalls.reduce(
    (sum, call) => sum + liveVoiceMinutesOf(call, nowMs) * callTariffCentsPerMin(call),
    0,
  );
}

export function makeMetering({ store }) {
  // Voice-Minuten-Meter EINES beendeten Calls (P6b3, Meter 2). NUR im Metering-Pfad
  // (PAYMENT_ENABLED, vom Aufrufer gegated) - Nebeneffekt (recordUsageEvent) im Namen.
  // 0 Minuten -> kein Event (kein Null-Beleg). Kosten-Cents aus dem Leg-Tarif (Ziel UND
  // Herkunft, callTariffCentsPerMin - EINE Kosten-Quelle G5) x Minuten.
  // KV-P1: diese Buchung + reconcileVoiceBudget darunter sind die Zeilen
  // voice_minute_outbound/voice_minute_inbound der Kosten-Landkarte
  // (src/billing/cost-ledger-map.js).
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

  // KV-P2: bucht die IST-Voice-Minuten eines BEENDETEN Calls BEIDER RICHTUNGEN (Minuten x
  // Leg-Satz) in den Budget-Bucket des Tenants - so sieht das Budget-Gate + die
  // Vorab-Reservierung die Carrier-Minuten. IMMER (auch ohne PAYMENT_ENABLED).
  // Der frueher hier stehende Richtungsfilter war die Hauptluecke des Plans: dieselben
  // Kosten desselben Anrufs wurden im Ledger (recordVoiceMinuteMeter, richtungsblind) und
  // auf der Gate-Achse (hier, nur outbound) verschieden gefiltert - waehrend die Decke
  // eingehende Anrufe bereits abweist (routes/voice.js). Der Name trug die Richtung mit;
  // beides ist mit dieser Phase weg (N2). Nie beantwortet -> 0 Minuten -> kein Abzug.
  // Nebeneffekt (Store-Mutation) im Namen (N7).
  function reconcileVoiceBudget(call) {
    const minutes = voiceMinutesOf(call);
    if (minutes <= 0) return;
    // LCT P2: EIN Ausdruck, EIN Wert - gebucht und persistiert wird dieselbe Zahl im selben
    // Schritt. Der Schaetzbetrag DARF spaeter NICHT aus tariffCentsPerMin rekonstruiert
    // werden: P4b senkt den Tarif, und P3 gleicht mit COST_TRUING_DELAY_MINUTES Verzug ab -
    // der ENV-Wechsel faellt genau in dieses Fenster. Eine gegen den NEUEN Tarif gerechnete
    // Korrektur erstattete real ausgegebenes Geld zurueck und oeffnete den geteilten
    // Lebenszeit-Topf wieder (Kapitel 4 des Plans).
    //
    // KS-P5, Bucket-Brigade (G31): der zweite Schritt konsumiert den RUECKGABEWERT des
    // ersten. Die Reihenfolge war bisher Konvention ("erst buchen, dann den Bezugswert
    // festhalten") und ist seit KS-P5 sicherheitstragend - die Anker muessen die
    // Achsen-Stempel NACH der Buchung sein, sonst zeigt die Gutschrift spaeter auf einen
    // Monat/eine Periode, in der die Belastung nie stand. Ueber den Rueckgabewert ist die
    // Reihenfolge nicht mehr vergessbar. Die Richtung im Zweifel bleibt die, die MEHR
    // gebucht laesst (fehlender Estimate -> P4 korrigiert gar nicht, fail-closed).
    const estimatedCostCents = minutes * callTariffCentsPerMin(call);
    const usage = store.addVoiceUsageCostCents(call.tenantId, estimatedCostCents);
    store.recordCallEstimatedCostCents(call.id, {
      costCents: estimatedCostCents,
      chargeAnchors: chargeAnchorsOfUsage(usage),
    });
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
  // KV-P1: diese Buchung ist die Zeile number_month der Kosten-Landkarte
  // (src/billing/cost-ledger-map.js).
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
    reconcileVoiceBudget,
    recordNumberMonthMeter,
    recordDueNumberMonthMeters,
  };
}
