// Onboarding-Orchestrierung: fuehrt eine 'requested' Nummer ueber den echten
// Provider-Kauf zu 'active'. Trennt die UNREINE Provider-IO (injizierter
// provisioner, DIP/P4) von der reinen State-Machine (state-ops). KEIN store.save()
// hier - der Aufrufer (Route) persistiert; KEIN config-Zugriff - Parameter werden
// hereingereicht (testbar mit makeDefaultState + Fake-Provisioner/Fake-Billing).
//
// Geld-Sicherheit (R4): eine Nummer erreicht 'active' NUR nach erfolgreichem Order
// UND Configure (Voice-Routing). Schlaegt Configure nach dem Kauf fehl, wird die
// Nummer beim Provider wieder FREIGEGEBEN (kein bezahlter Orphan) und der Zustand
// faellt auf 'failed'. Der Idempotency-Key (number-id-basiert) verhindert
// Doppelkaeufe bei Retry. Die Cap-Notbremse (maxNumbers) sitzt VOR diesem Schritt
// (requestNumber) - hier wird nur eine bereits angefragte Nummer durchgereicht.
//
// Payment (P6b1, optional ueber deps.billing): ist ein Billing-Client injiziert,
// wird VOR dem ersten Provider-Call Geld reserviert (placeHold) und NACH dem
// Configure - direkt vor der Aktivierung - eingezogen (captureHold). Schlaegt etwas
// nach dem Hold fehl, gibt cancelHold die Reservierung wieder frei. 'billing' ist
// eine Dependency (kein Datum) -> sie reist mit 'provisioner' im deps-Objekt
// ({ provisioner, billing }), billing optional/null (F1, 3 Args). Ohne billing
// (payment-off) ist der Pfad byte-identisch zum Bestand (kein Hold/Capture).
import {
  beginProvisioning,
  beginCapturing,
  activateNumber,
  failNumber,
  releaseNumber,
  findNumber,
} from "./store/state-ops.js";

// Orchestriert requested -> provisioning -> (search + order + configure) -> active,
// mit optionalem Hold-vor-Order + Capture-vor-Active (deps.billing). Fehlerpfade:
// search/order-Fehler -> failed (kein Kauf) + Hold-Freigabe; configure/capture-Fehler
// nach dem Kauf -> Provider-Release + failed + Hold-Freigabe. Liefert die aktivierte Nummer.
export async function provisionNumber(s, deps, { numberId, countryCode, connectionId, type, holdAmountCents, currency }) {
  const { provisioner, billing } = deps;
  const number = findNumber(s, numberId);
  if (!number) throw new Error(`provisionNumber: Nummer ${numberId} nicht gefunden`);

  // Hold VOR jedem Provider-Call (Money-Safety R4): kein orderNumber ohne reserviertes
  // Geld. Schlaegt der Hold fehl, bleibt die Nummer 'requested' -> failNumber, KEIN
  // Provider-Call, KEIN cancelHold (es wurde nichts gehalten).
  let paymentIntentId = null;
  if (billing) {
    try {
      const hold = await billing.placeHold({
        tenantRef: number.tenantId,
        amountCents: holdAmountCents,
        currency,
        idempotencyKey: `hold_${numberId}`,
      });
      paymentIntentId = hold.paymentIntentId;
    } catch (holdErr) {
      failNumber(s, numberId); // requested -> failed (kein Hold, kein Provider-Call)
      throw holdErr;
    }
    beginProvisioning(s, numberId, paymentIntentId); // requested -> provisioning + PI hinterlegen
  } else {
    beginProvisioning(s, numberId); // payment-off: 2-arg, byte-identisch
  }

  // Idempotency-Key an die number-id gebunden: ein Retry desselben Provisioning
  // kauft beim Provider nie doppelt (Plan-Schloss 3).
  const idempotencyKey = `order_${numberId}`;

  let ordered;
  try {
    const candidates = await provisioner.searchNumbers({ countryCode, type, limit: 1 });
    const candidate = candidates[0];
    if (!candidate) throw new Error("provisionNumber: keine kaufbare Nummer verfuegbar");
    ordered = await provisioner.orderNumber({ e164: candidate.e164, idempotencyKey });
  } catch (err) {
    failNumber(s, numberId); // provisioning -> failed (kein Kauf zustande gekommen)
    await cancelHoldIfHeld(billing, paymentIntentId); // Geld freigeben (nichts gekauft)
    throw err;
  }

  try {
    await provisioner.configureNumber({ providerNumberId: ordered.providerNumberId, connectionId });
  } catch (cfgErr) {
    await rollbackAfterOrder(s, numberId, { provisioner, providerNumberId: ordered.providerNumberId, billing, paymentIntentId });
    throw cfgErr;
  }

  if (billing) {
    beginCapturing(s, numberId); // provisioning -> capturing (Geld-Einzug laeuft)
    try {
      await billing.captureHold(paymentIntentId, holdAmountCents);
    } catch (capErr) {
      await rollbackAfterOrder(s, numberId, { provisioner, providerNumberId: ordered.providerNumberId, billing, paymentIntentId });
      throw capErr;
    }
  }

  return activateNumber(s, numberId, { e164: ordered.e164, providerNumberId: ordered.providerNumberId });
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

// Rollback NACH erfolgreichem Order (configure- oder capture-Fehler): Zustand failed,
// Provider-Nummer freigeben (kein bezahlter Orphan), Hold freigeben. Bei sauberem
// Provider-Release wird der Datensatz terminal released; sonst bleibt er failed
// (moeglicher Orphan -> Reconciliation, durch die MAX_NUMBERS-Cap gedeckelt). Eine
// Stelle fuer beide Fehlerkanten (G5/S2). Bei billing=null ist cancelHoldIfHeld ein
// No-op -> der payment-off configure-Pfad bleibt byte-identisch zum Bestand.
async function rollbackAfterOrder(s, numberId, { provisioner, providerNumberId, billing, paymentIntentId }) {
  failNumber(s, numberId); // provisioning|capturing -> failed
  try {
    await provisioner.releaseNumber(providerNumberId);
    releaseNumber(s, numberId); // failed -> released (Provider-Nummer sauber weg)
  } catch {
    /* Provider-Release fehlgeschlagen -> Zustand bleibt 'failed' (Reconciliation) */
  }
  await cancelHoldIfHeld(billing, paymentIntentId);
}
