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
// direkt vor der Aktivierung - geschlossen (settleSetupFeeHold: Einzug ODER Storno,
// GAP-05). Schlaegt etwas nach dem Hold fehl, gibt cancelHold die Reservierung wieder
// frei. 'billing' ist eine Dependency (kein Datum) -> sie reist mit 'provisioner' im
// deps-Objekt ({ provisioner, billing }), billing optional/null (F1, 3 Args). Ohne
// billing (payment-off) ist der Pfad byte-identisch zum Bestand (kein Hold/Capture).
//
// GAP-05 (Gutschein-Missbrauch): der Setup-Hold wird IMMER gestellt, auch fuer einen
// per numberSetupFeeExempt befreiten Tenant - eine Karte OHNE gueltigen Hold darf nie
// eine Nummer bekommen. Die Befreiung wirkt nur noch auf die PREIS-Achse: statt
// captureHold laeuft cancelHold (settleSetupFeeHold).
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

  // Hold VOR jedem Provider-Call (Money-Safety R4, GAP-05: der Hold ist der GATE - er wird
  // IMMER gestellt, auch fuer einen per Gutschein befreiten Tenant). Schlaegt der Hold fehl,
  // bleibt die Nummer 'requested' -> failNumber, KEIN Provider-Call, KEIN cancelHold (es
  // wurde nichts gehalten).
  let paymentIntentId = null;
  let setupFeeExempt = false;
  if (billing) {
    ({ paymentIntentId, exempt: setupFeeExempt } = await placeSetupFeeHold(s, numberId, {
      tenantId: number.tenantId,
      billing,
      holdAmountCents,
      currency,
    }));
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

  // GAP-05: der Hold wird IMMER geschlossen - regulaer per Einzug, befreit per Storno
  // (settleSetupFeeHold). billing=null (payment-off) -> kein Hold gestellt, nichts zu
  // schliessen.
  if (billing) {
    try {
      await settleSetupFeeHold(s, numberId, {
        billing,
        paymentIntentId,
        holdAmountCents,
        exempt: setupFeeExempt,
      });
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

// Reserviert die Einrichtungsgebuehr. GAP-05: der Hold ist der GATE - er wird IMMER
// gestellt, auch fuer einen befreiten Tenant (100-%-Gutschein, numberSetupFeeExempt).
// Die Befreiung wirkt nur noch auf die PREIS-Achse: sie entscheidet am Ende ueber Storno
// statt Einzug (settleSetupFeeHold). Money-Safety (R4, fail-closed) bleibt unveraendert:
// ohne hinterlegte Karte KEIN placeHold und KEIN Provider-Call - off_session-Hold braucht
// customer + payment_method, auch im befreiten Pfad (ohne gueltige Karte lehnt Stripe den
// Hold ab -> failNumber, also auch dort KEINE Nummer ohne Karte; zusaetzlich strukturell
// abgesichert ueber payment_method_collection='always' im Checkout, stripe.js).
// Liefert { paymentIntentId, exempt } (EIN Rueckgabewert statt Output-Argument, F2).
async function placeSetupFeeHold(s, numberId, { tenantId, billing, holdAmountCents, currency }) {
  const exempt = tenantSubscription(s, tenantId).numberSetupFeeExempt;
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
  return { paymentIntentId, exempt };
}

// Schliesst den Setup-Hold ab: Einzug (regulaer) ODER Storno (befreit, GAP-05). Beides
// laeuft ueber DIESELBE Fehlerkante (rollbackAfterOrder beim Aufrufer) - ein gescheiterter
// Abschluss darf nie eine bezahlte/gehaltene Waise hinterlassen (G5, kein zweiter
// Rollback-Pfad).
async function settleSetupFeeHold(s, numberId, { billing, paymentIntentId, holdAmountCents, exempt }) {
  beginCapturing(s, numberId); // provisioning -> capturing (Geld-Abschluss laeuft)
  if (exempt) return billing.cancelHold(paymentIntentId);
  return billing.captureHold(paymentIntentId, holdAmountCents);
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
