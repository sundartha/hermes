// Onboarding-Orchestrierung: fuehrt eine 'requested' Nummer ueber den echten
// Provider-Kauf zu 'active'. Trennt die UNREINE Provider-IO (injizierter
// provisioner, DIP/P4) von der reinen State-Machine (state-ops). KEIN store.save()
// hier - der Aufrufer (Route) persistiert; KEIN config-Zugriff - Parameter werden
// hereingereicht (testbar mit makeDefaultState + Fake-Provisioner/Fake-Billing).
//
// Geld-Sicherheit (R4): eine Nummer erreicht 'active' NUR nach erfolgreichem Order
// (inkl. Voice-Routing via connection_id im Order-Body) und - im Payment-Pfad -
// Capture. Schlaegt der Capture nach dem Kauf fehl, wird die Nummer beim Provider
// wieder FREIGEGEBEN (kein bezahlter Orphan) und der Zustand faellt auf 'failed'.
// Der Idempotency-Key (number-id-basiert) verhindert Doppelkaeufe bei Retry. Die
// Cap-Notbremse (maxNumbers) sitzt VOR diesem Schritt (requestNumber) - hier wird
// nur eine bereits angefragte Nummer durchgereicht.
//
// Payment (P6b1, optional ueber deps.billing): ist ein Billing-Client injiziert,
// wird VOR dem ersten Provider-Call Geld reserviert (placeHold) und NACH dem Order -
// direkt vor der Aktivierung - eingezogen (captureHold). Schlaegt etwas nach dem Hold
// fehl, gibt cancelHold die Reservierung wieder frei. 'billing' ist eine Dependency
// (kein Datum) -> sie reist mit 'provisioner' im deps-Objekt ({ provisioner, billing }),
// billing optional/null (F1, 3 Args). Ohne billing (payment-off) ist der Pfad
// byte-identisch zum Bestand (kein Hold/Capture).
import {
  beginProvisioning,
  beginCapturing,
  activateNumber,
  failNumber,
  releaseNumber,
  findNumber,
  tenantStripe,
  tenantSubscription,
} from "./store/state-ops.js";

// R5 (Phase P7): statt limit:1 mehrere Kandidaten holen und den ersten verfuegbaren
// waehlen. Eine einzelne Treffer-Anfrage scheitert haeufiger an einer zwischenzeitlich
// vergebenen Nummer; ein kleines Fenster macht die Suche robust, ohne die Antwort
// aufzublaehen. Auswahl bleibt deterministisch (erster Kandidat). Aendert KEIN
// Idempotenz-Schloss (Order-Key/Hold/Zustand bleiben byte-identisch).
const PROVISION_SEARCH_LIMIT = 10;

// Orchestriert requested -> provisioning -> (search + order[+routing]) -> active,
// mit optionalem Hold-vor-Order + Capture-vor-Active (deps.billing). Fehlerpfade:
// search/order-Fehler -> failed (kein Kauf) + Hold-Freigabe; capture-Fehler (Payment-
// Pfad) nach dem Kauf -> Provider-Release + failed + Hold-Freigabe. Liefert die aktivierte Nummer.
export async function provisionNumber(
  s,
  deps,
  { numberId, countryCode, connectionId, type, holdAmountCents, currency },
) {
  const { provisioner, billing, logger = console } = deps;
  const number = findNumber(s, numberId);
  if (!number) throw new Error(`provisionNumber: Nummer ${numberId} nicht gefunden`);

  // Hold VOR jedem Provider-Call (Money-Safety R4): kein orderNumber ohne reserviertes
  // Geld. Schlaegt der Hold fehl, bleibt die Nummer 'requested' -> failNumber, KEIN
  // Provider-Call, KEIN cancelHold (es wurde nichts gehalten).
  let paymentIntentId = null;
  if (billing) {
    paymentIntentId = await placeHoldUnlessExempt(s, numberId, {
      tenantId: number.tenantId,
      billing,
      holdAmountCents,
      currency,
    });
  } else {
    beginProvisioning(s, numberId); // payment-off: 2-arg, byte-identisch
  }

  // Idempotency-Key an die number-id gebunden: ein Retry desselben Provisioning
  // kauft beim Provider nie doppelt (Plan-Schloss 3).
  const idempotencyKey = `order_${numberId}`;

  let ordered;
  try {
    const candidates = await provisioner.searchNumbers({
      countryCode,
      type,
      limit: PROVISION_SEARCH_LIMIT,
    });
    const candidate = candidates[0];
    // R5: 0 Treffer -> kontrollierter Fehler (NICHT Crash). Faengt im try/catch ->
    // failNumber + Hold-Freigabe, kein Provider-Kauf (kein bezahlter Orphan).
    if (!candidate)
      throw new Error(`provisionNumber: keine kaufbare Nummer fuer ${countryCode} verfuegbar`);
    ordered = await provisioner.orderNumber({ e164: candidate.e164, connectionId, idempotencyKey });
  } catch (err) {
    failNumber(s, numberId); // provisioning -> failed (kein Kauf zustande gekommen)
    await cancelHoldIfHeld(billing, paymentIntentId); // Geld freigeben (nichts gekauft)
    throw err;
  }

  // Kein Hold -> nichts zu erfassen (Fix B: exempt = billing gesetzt, aber
  // paymentIntentId bleibt null).
  if (billing && paymentIntentId) {
    beginCapturing(s, numberId); // provisioning -> capturing (Geld-Einzug laeuft)
    try {
      await billing.captureHold(paymentIntentId, holdAmountCents);
    } catch (capErr) {
      await rollbackAfterOrder(s, numberId, {
        provisioner,
        providerNumberId: ordered.providerNumberId,
        billing,
        paymentIntentId,
        logger,
      });
      throw capErr;
    }
  }

  return activateNumber(s, numberId, {
    e164: ordered.e164,
    providerNumberId: ordered.providerNumberId,
  });
}

// Hold freigeben, falls einer gehalten wurde (Rollback). billing/paymentIntentId
// koennen null sein (payment-off bzw. Fehler vor dem Hold) -> No-op. Stripe-Cancel-
// Fehler verschluckt: der urspruengliche Fehler des Aufrufers darf nicht maskiert
// werden (Best-Effort-Rollback; Reconciliation deckt den Rest, durch die Cap gedeckelt).
async function cancelHoldIfHeld(billing, paymentIntentId) {
  if (!billing || !paymentIntentId) return;
  try {
    await billing.cancelHold(paymentIntentId);
  } catch {
    /* Best-Effort-Rollback: Cancel-Fehler nicht ueber den Aufrufer-Fehler legen */
  }
}

// Reserviert das Geld fuer die Einrichtungsgebuehr, AUSSER der Tenant ist befreit (Fix B:
// numberSetupFeeExempt, gesetzt in activation.js/syncNumberSetupFeeExemption - EINE
// Quelle fuer Checkout-Return- UND Webhook-Pfad). Befreit -> beginProvisioning wie
// payment-off (kein PI zu vermerken), Rueckgabe null (Aufrufer ueberspringt captureHold).
// Sonst: Money-Safety wie bisher (Karte-Pflicht, Hold, dann beginProvisioning mit PI).
// EIN Rueckgabewert statt Output-Argument (F2).
async function placeHoldUnlessExempt(s, numberId, { tenantId, billing, holdAmountCents, currency }) {
  if (tenantSubscription(s, tenantId).numberSetupFeeExempt) {
    beginProvisioning(s, numberId);
    return null;
  }
  // Money-Safety (R4, fail-closed): ohne hinterlegte Karte KEIN placeHold und KEIN
  // Provider-Call. off_session-Hold braucht customer + payment_method.
  const { customerId, paymentMethodId } = tenantStripe(s, tenantId);
  if (!customerId || !paymentMethodId) {
    failNumber(s, numberId);
    throw new Error(`provisionNumber: Tenant ${tenantId} hat kein hinterlegtes Zahlungsmittel`);
  }
  let paymentIntentId;
  try {
    const hold = await billing.placeHold({
      tenantRef: tenantId,
      amountCents: holdAmountCents,
      currency,
      customerId,
      paymentMethodId,
      idempotencyKey: `hold_${numberId}`,
    });
    paymentIntentId = hold.paymentIntentId;
  } catch (holdErr) {
    failNumber(s, numberId);
    throw holdErr;
  }
  beginProvisioning(s, numberId, paymentIntentId);
  return paymentIntentId;
}

// Rollback NACH erfolgreichem Order (capture-Fehler, Payment-Pfad): Zustand failed,
// Provider-Nummer freigeben (kein bezahlter Orphan), Hold freigeben. Bei sauberem
// Provider-Release wird der Datensatz terminal released; sonst bleibt er failed
// (moeglicher Orphan -> Reconciliation, durch die MAX_NUMBERS-Cap gedeckelt). Eine
// Stelle fuer beide Fehlerkanten (G5/S2). Bei billing=null ist cancelHoldIfHeld ein
// No-op -> der payment-off Pfad erreicht diese Stelle nicht (nur Capture wirft hier).
async function rollbackAfterOrder(
  s,
  numberId,
  { provisioner, providerNumberId, billing, paymentIntentId, logger },
) {
  failNumber(s, numberId); // provisioning|capturing -> failed
  try {
    await provisioner.releaseNumber(providerNumberId);
    releaseNumber(s, numberId); // failed -> released (Provider-Nummer sauber weg)
  } catch (relErr) {
    // GAP-2: Release-Fehler NICHT mehr still schlucken. Ein gekaufter, nicht freigegebener
    // Provider-Datensatz = bezahlter Orphan -> sichtbar fuers Owner-Reconcile-Runbook.
    // PII-/Secret-frei: nur interne ids + Adapter-Meldung (Regel 4: kein API-Key im Text).
    logger.warn(
      `provisionNumber: releaseNumber fehlgeschlagen -> Orphan, Reconcile noetig ` +
        `(number=${numberId} provider=${providerNumberId}): ${relErr.message}`,
    );
  }
  await cancelHoldIfHeld(billing, paymentIntentId);
}
