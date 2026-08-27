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
// wird VOR dem Kauf Geld reserviert (placeHold) und NACH dem Order -
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
//
// REIHENFOLGE (P4/GAP-11): (1) Karten-Gate, (2) Zustands-Schloss, (3) read-only
// Preis-Suche, (4) Hold in Hoehe des Provider-Preises, (5) Kauf, (6) Abschluss. Die
// Suche steht VOR dem Hold, weil der Einmalpreis erst in der Provider-Antwort steht -
// sie reserviert nichts und kauft nichts. Die geld-tragende Invariante ist unveraendert
// "kein orderNumber ohne erfolgreichen Hold", und das Karten-Gate sitzt jetzt sogar
// FRUEHER als zuvor (vor jedem Provider-Kontakt).
//
// R4-PRAEZISIERUNG (GAP-11) - sie steht NICHT im Ermessen dieser Implementierung,
// sondern folgt der Owner-Entscheidung vom 2026-07-28, protokolliert in der Phasen-
// Spezifikation der Gates-Fix-Kette (Abschnitt P4, Nachtrag zur Reihenfolgen-Frage):
// Die Einrichtungsgebuehr, die dieser Hold reserviert, ist per Konfiguration
// abgeschaltet - der Kunde zahlt sein Abo und sonst nichts; die Nummer ist unsere
// Kosten, gedeckt vom Abo. searchNumbers ist eine reine Preisabfrage: kostenlos,
// reserviert nichts, kauft nichts. Die geld-tragende Zusage lautet deshalb praezise
// "kein KAUF ohne reserviertes Geld" (statt: kein Kontakt zum Provider) - orderNumber,
// der einzige geldbewegende Schritt, liegt weiterhin strikt HINTER dem erfolgreichen
// Hold. AKZEPTIERTES RESTRISIKO: ein Tenant mit hinterlegter, aber am Hold abgelehnter
// Karte loest je manuellem Provisionierungs-Versuch (kein Auto-Retry) einen
// zusaetzlichen read-only Suchaufruf beim Provider aus, BEVOR der Hold scheitert. Es
// wird dabei nie Geld bewegt und keine Nummer gekauft - das Restrisiko ist
// Provider-Traffic, kein Geldverlust.
import {
  beginProvisioning,
  beginCapturing,
  activateNumber,
  attachNumberPaymentIntent,
  failNumber,
  releaseNumber,
  findNumber,
  numberBusyReason,
  tenantStripe,
  tenantSubscription,
} from "./store/state-ops.js";
import {
  holdAmountForProviderPrice,
  monthlyCostCentsForProviderPrice,
} from "./telephony/provisioning-geo.js";

// R5 (Phase P7): statt limit:1 mehrere Kandidaten holen und den ersten verfuegbaren
// waehlen. Eine einzelne Treffer-Anfrage scheitert haeufiger an einer zwischenzeitlich
// vergebenen Nummer; ein kleines Fenster macht die Suche robust, ohne die Antwort
// aufzublaehen. Auswahl bleibt deterministisch (erster Kandidat). Aendert KEIN
// Idempotenz-Schloss (Order-Key/Hold/Zustand bleiben byte-identisch).
const PROVISION_SEARCH_LIMIT = 10;

// Orchestriert requested -> provisioning -> (search + order[+routing]) -> active,
// mit optionalem Hold-vor-Order + Capture-vor-Active (deps.billing). Fehlerpfade:
// search-Fehler -> failed (kein Kauf, noch kein Hold gestellt); order-Fehler -> failed
// (kein Kauf) + Hold-Freigabe; capture-Fehler (Payment-Pfad) nach dem Kauf ->
// Provider-Release + failed + Hold-Freigabe. Liefert die aktivierte Nummer.
export async function provisionNumber(
  s,
  deps,
  { numberId, countryCode, connectionId, type, holdAmountCents, currency },
) {
  const { provisioner, billing, logger = console } = deps;
  const number = findNumber(s, numberId);
  if (!number) throw new Error(`provisionNumber: Nummer ${numberId} nicht gefunden`);

  // Zahlungsfaehigkeit als ERSTES (fail-closed, unveraendert scharf): ohne hinterlegte
  // Karte gibt es weder Preis-Suche noch Kauf. Reiner Zustands-Check, kein Provider-Call.
  const card = billing ? requireTenantCard(s, numberId, number.tenantId) : null;

  // Zustands-Schloss #2 frueh setzen (requested -> provisioning), damit die zusaetzliche
  // Preis-Suche das Doppelkauf-Fenster NICHT verbreitert.
  beginProvisioning(s, numberId);

  // Preis-Suche VOR dem Hold (GAP-11): der Einmalpreis steht in der Provider-Antwort,
  // ein Hold in seiner Hoehe ist ohne sie unmoeglich. Read-only: reserviert nichts,
  // kauft nichts. Die geld-tragende Invariante bleibt "kein orderNumber ohne Hold".
  const candidate = await findPurchasableNumber(s, numberId, {
    provisioner,
    countryCode,
    type,
  });

  // Hold in Hoehe des Provider-Preises; ohne verwertbaren Preis die hereingereichte
  // Pauschale (holdAmountForCountry-Ergebnis des Aufrufers) - NIE 0, NIE geraten.
  const effectiveHoldCents = holdAmountForProviderPrice(candidate.price, holdAmountCents);

  // GAP-05: der Hold ist der GATE - er wird IMMER gestellt, auch fuer einen per Gutschein
  // befreiten Tenant. Schlaegt er fehl -> failNumber, KEIN Kauf, KEIN cancelHold (es wurde
  // nichts gehalten).
  let paymentIntentId = null;
  let setupFeeExempt = false;
  if (billing) {
    ({ paymentIntentId, exempt: setupFeeExempt } = await placeSetupFeeHold(s, numberId, {
      tenantId: number.tenantId,
      billing,
      card,
      holdAmountCents: effectiveHoldCents,
      currency,
    }));
  }

  // Idempotency-Key an die number-id gebunden: ein Retry desselben Provisioning
  // kauft beim Provider nie doppelt (Plan-Schloss 3).
  const idempotencyKey = `order_${numberId}`;

  let ordered;
  try {
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
        holdAmountCents: effectiveHoldCents, // Hold == Capture (R3) bleibt EINE Zahl
        exempt: setupFeeExempt,
      });
    } catch (capErr) {
      await rollbackAfterOrder(s, numberId, {
        provisioner,
        providerNumberId: ordered.providerNumberId,
        e164: ordered.e164,
        tenantId: number.tenantId,
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
    // Monatsmiete aus derselben Provider-Antwort -> P5 bucht genau diesen Wert.
    monthlyCostCents: monthlyCostCentsForProviderPrice(candidate.price),
  });
}

// Read-only Preis-/Verfuegbarkeitssuche: liefert den ersten Kandidaten (mit seinem
// Provider-Preis, falls die Antwort ihn traegt). R5: 0 Treffer -> kontrollierter Fehler
// (NICHT Crash). Jeder Fehlschlag setzt die Nummer auf 'failed'; ein Hold ist an dieser
// Stelle noch nicht gestellt, also gibt es auch nichts freizugeben.
async function findPurchasableNumber(s, numberId, { provisioner, countryCode, type }) {
  try {
    const candidates = await provisioner.searchNumbers({
      countryCode,
      type,
      limit: PROVISION_SEARCH_LIMIT,
    });
    const candidate = candidates[0];
    if (!candidate)
      throw new Error(`provisionNumber: keine kaufbare Nummer fuer ${countryCode} verfuegbar`);
    return candidate;
  } catch (err) {
    failNumber(s, numberId); // nichts gehalten -> nichts freizugeben
    throw err;
  }
}

// Fail-closed-Gate VOR jedem Provider-Call: ohne hinterlegte Karte kein Kauf und keine
// Preis-Suche. EINE Stelle, die tenantStripe liest (G5); der Hold bekommt das Ergebnis
// gereicht. Fehlermeldung woertlich wie bisher (Bestandstest pinnt sie).
function requireTenantCard(s, numberId, tenantId) {
  const card = tenantStripe(s, tenantId);
  if (!card.customerId || !card.paymentMethodId) {
    failNumber(s, numberId);
    throw new Error(`provisionNumber: Tenant ${tenantId} hat kein hinterlegtes Zahlungsmittel`);
  }
  return card;
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
// customer + payment_method, auch im befreiten Pfad; geprueft wird das beim Aufrufer
// (requireTenantCard), der die Karte hier hereinreicht. Zusaetzlich strukturell
// abgesichert ueber payment_method_collection='always' im Checkout (stripe.js).
// Liefert { paymentIntentId, exempt } (EIN Rueckgabewert statt Output-Argument, F2).
async function placeSetupFeeHold(s, numberId, { tenantId, billing, card, holdAmountCents, currency }) {
  const exempt = tenantSubscription(s, tenantId).numberSetupFeeExempt;
  const { customerId, paymentMethodId } = card;
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
  attachNumberPaymentIntent(s, numberId, paymentIntentId);
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
//
// OUTBOUND-E1 (Review-Blocker Runde 3): dies ist der ZWEITE Aufrufer von
// provisioner.releaseNumber (dem irreversiblen Anbieter-DELETE) im Repo, neben
// release-reconcile.js/performNumberRelease. Anders als dort hat dieser Pfad kein
// eigenes Verdikt (Ebene B) - deshalb hier derselbe Regel-Kern davor (numberBusyReason,
// G5, EINE Quelle mit Ebene A/B). Strukturell kann die HIER gerade erst gekaufte,
// nie aktivierte Nummer heute keine Plattform-Bindung tragen (number.e164 wird
// ausschliesslich in activateNumber gesetzt, s. requestNumber/state-ops.js - vor dieser
// Stelle ist der Store-Datensatz noch e164=null); der Recheck belegt genau das UND
// deckt eine kuenftige Aenderung ab (z.B. eine Vor-Aktivierungs-Bindung), ohne dass ein
// spaeterer Umbau diese Stelle neu bedenken muss. Bei Treffer: kein Provider-Kontakt,
// HOLD statt Delete - der Retry-/Reconcile-Weg (MAX_NUMBERS-Cap) uebernimmt den Orphan,
// wie beim regulaeren GAP-2-Pfad unten.
async function rollbackAfterOrder(
  s,
  numberId,
  { provisioner, providerNumberId, e164, tenantId, billing, paymentIntentId, logger },
) {
  failNumber(s, numberId); // provisioning|capturing -> failed
  if (e164 && numberBusyReason(s, { e164 }, { forTenantId: tenantId })) {
    logger.warn(
      `provisionNumber: releaseNumber uebersprungen (Plattform-Bindung) -> Orphan, Reconcile noetig ` +
        `(number=${numberId} provider=${providerNumberId})`,
    );
    await cancelHoldIfHeld(billing, paymentIntentId);
    return;
  }
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
