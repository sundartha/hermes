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
// sondern folgt der Owner-Entscheidung vom 2026-09-11 (Geldpfad-Plan, Abschnitt 3.2).
// Sie ueberholt die aeltere R4-Position vom 2026-07-28, die hier eine abgeschaltete
// Einrichtungsgebuehr behauptete: die Gebuehr ist gewollt, der Kunde zahlt sie
// zusaetzlich zum Abo. Wie hoch der Betrag ist, entscheidet holdAmountForProviderPrice
// weiter oben - der Einmalpreis des Providers, ersatzweise die hereingereichte
// Pauschale aus NUMBER_SETUP_FEE_CENTS. Null wird er nie: der Boot-Waechter erzwingt
// bei PAYMENT_ENABLED=true einen ganzzahligen Wert groesser null (config.js), und die
// Oberflaeche weist den Betrag vor dem Checkout aus (self-service-routes.js). Ob der
// Hold am Ende eingezogen oder storniert wird, entscheidet allein numberSetupFeeExempt
// in settleSetupFeeHold. Quelle dieses Feldes ist die Rechnungssumme des laufenden
// Abos: eine Nullrechnung befreit (retrieveSubscription in billing/stripe.js,
// fail-closed - unbekannt heisst nicht befreit). Die Rechnungssumme ist dabei ein
// bewusst gewaehlter Stellvertreter fuer "zahlt ohnehin nichts", kein Zufall; ein
// eigenes Befreiungs-Signal gibt es absichtlich nicht (Owner-Entscheidung vom selben
// Tag). searchNumbers ist eine reine Preisabfrage: kostenlos, reserviert nichts, kauft
// nichts. Die geld-tragende Zusage lautet deshalb praezise "kein KAUF ohne reserviertes
// Geld" (statt: kein Kontakt zum Provider) - orderNumber, der einzige geldbewegende
// Schritt, liegt weiterhin strikt HINTER dem erfolgreichen Hold. AKZEPTIERTES
// RESTRISIKO: ein Tenant mit hinterlegter, aber am Hold abgelehnter Karte loest je
// manuellem Provisionierungs-Versuch (kein Auto-Retry) einen zusaetzlichen read-only
// Suchaufruf beim Provider aus, BEVOR der Hold scheitert. Es wird dabei nie Geld bewegt
// und keine Nummer gekauft - das Restrisiko ist Provider-Traffic, kein Geldverlust.
import {
  beginProvisioning,
  beginCapturing,
  activateNumber,
  attachNumberPaymentIntent,
  attachNumberRegistration,
  markNumberElInboundTrunkBelegt,
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
import { isHoldCapablePaymentMethodType } from "./billing/payment-method-eligibility.js";
import { TRUNK_BELEG } from "./elevenlabs/inbound-trunk-beleg.js";

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
  state,
  deps,
  { numberId, countryCode, connectionId, type, holdAmountCents, currency },
) {
  const { provisioner, billing, sipRegistrar, inboundTrunkSchreiber, logger = console } = deps;
  const number = findNumber(state, numberId);
  if (!number) throw new Error(`provisionNumber: Nummer ${numberId} nicht gefunden`);

  // Zahlungsfaehigkeit als ERSTES (fail-closed, unveraendert scharf): ohne hinterlegte
  // Karte gibt es weder Preis-Suche noch Kauf. Reiner Zustands-Check, kein Provider-Call.
  const card = billing ? requireTenantCard(state, numberId, number.tenantId) : null;

  // Zustands-Schloss #2 frueh setzen (requested -> provisioning), damit die zusaetzliche
  // Preis-Suche das Doppelkauf-Fenster NICHT verbreitert.
  beginProvisioning(state, numberId);

  // Preis-Suche VOR dem Hold (GAP-11): der Einmalpreis steht in der Provider-Antwort,
  // ein Hold in seiner Hoehe ist ohne sie unmoeglich. Read-only: reserviert nichts,
  // kauft nichts. Die geld-tragende Invariante bleibt "kein orderNumber ohne Hold".
  const candidate = await findPurchasableNumber(state, numberId, {
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
    ({ paymentIntentId, exempt: setupFeeExempt } = await placeSetupFeeHold(state, numberId, {
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
    failNumber(state, numberId); // provisioning -> failed (kein Kauf zustande gekommen)
    await cancelHoldIfHeld(billing, paymentIntentId); // Geld freigeben (nichts gekauft)
    throw err;
  }

  // GAP-05: der Hold wird IMMER geschlossen - regulaer per Einzug, befreit per Storno
  // (settleSetupFeeHold). billing=null (payment-off) -> kein Hold gestellt, nichts zu
  // schliessen.
  if (billing) {
    try {
      await settleSetupFeeHold(state, numberId, {
        billing,
        paymentIntentId,
        holdAmountCents: effectiveHoldCents, // Hold == Capture (R3) bleibt EINE Zahl
        exempt: setupFeeExempt,
      });
    } catch (capErr) {
      await rollbackAfterOrder(state, numberId, {
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

  const activatedNumber = activateNumber(state, numberId, {
    e164: ordered.e164,
    providerNumberId: ordered.providerNumberId,
    // Monatsmiete aus derselben Provider-Antwort -> P5 bucht genau diesen Wert.
    monthlyCostCents: monthlyCostCentsForProviderPrice(candidate.price),
  });
  // OUTBOUND-E5 (F3): die EL-Nummernregistrierung DIESER DID. Optionale Dependency (Muster
  // billing): nicht injiziert -> No-op, Bestandsverhalten BYTE-IDENTISCH. NACH der
  // Aktivierung und FEHLERTOLERANT: die DID ist gekauft und bezahlt, sie bleibt nutzbar.
  // Ein Fehlschlag laesst providerAgentPhoneNumberId NULL - der Anrufstart faellt dann LAUT
  // auf die globale Registrierung zurueck und der Reparaturlauf holt es nach. Ein Wurf hier
  // wuerde eine bezahlte, funktionierende Nummer auf 'failed' zurueckrollen - genau die
  // Kaskade, die es nicht geben darf.
  await registriereNummerFailSoft(state, activatedNumber, { sipRegistrar, logger });
  // IEX-A10 (E13): Inbound-Trunk DIESER DID. Optionale Dependency (Gate zu, u. a. Scope allowlist ->
  // nicht injiziert -> No-op, Bestand byte-identisch). Fehlertolerant wie die Registrierung.
  await schreibeInboundTrunkFailSoft(state, activatedNumber, { inboundTrunkSchreiber, logger });
  return activatedNumber;
}

// Fehlertolerantes Anlegen. Schloss #1 (Zustand): eine Nummer, die bereits eine Kennung
// traegt, loest KEINEN Anbieter-Aufruf aus - zweimal aufgerufen entsteht keine zweite
// Registrierung. Kein Wurf nach aussen; jeder Fehlschlag ist EINE benannte, gezaehlte
// Log-Zeile (nie stilles Gruen), PII-/Secret-frei (nur interne IDs, nie e164, nie Passwort).
async function registriereNummerFailSoft(state, number, { sipRegistrar, logger = console }) {
  if (!sipRegistrar || number.providerAgentPhoneNumberId) return;
  try {
    const { phoneNumberId, angelegt } = await sipRegistrar.ensureRegistration({
      e164: number.e164,
      numberId: number.id,
    });
    attachNumberRegistration(state, number.id, phoneNumberId);
    logger.log(`[el-registrierung] number=${number.id} angelegt=${angelegt}`);
  } catch (err) {
    logger.warn(
      `[el-registrierung] FEHLGESCHLAGEN number=${number.id}: ${err.message} - DID bleibt nutzbar, Registrierung nachholbar`,
    );
  }
}

// Schreibt beim Anbieter den Inbound-Trunk und setzt NUR bei Lesebeleg BELEGT die Beleg-Felder am
// state (der Aufrufer persistiert). Kein Wurf nach aussen: eine bezahlte, aktive DID darf daran nie
// scheitern. Ohne Beleg hoert die DID unter registrierte_dids den Fehlersatz, bis der naechste
// Boot-Sweep sie repariert (E15(i)/E16). Log nur nummer_id + Beleg-Token, nie Fehlertext.
async function schreibeInboundTrunkFailSoft(state, number, { inboundTrunkSchreiber, logger = console }) {
  if (!inboundTrunkSchreiber || !number.providerAgentPhoneNumberId) return;
  try {
    const beleg = await inboundTrunkSchreiber.ensureInboundTrunk(number);
    if (beleg === TRUNK_BELEG.BELEGT)
      markNumberElInboundTrunkBelegt(state, number.id, {
        nowIso: new Date().toISOString(),
        zugangFp: inboundTrunkSchreiber.zugangFp,
      });
    logger.log(`[el-trunk] onboarding nummer_id=${number.id} beleg=${beleg}`);
  } catch {
    logger.warn(
      `[el-trunk] onboarding FEHLGESCHLAGEN nummer_id=${number.id} - DID bleibt nutzbar, Boot-Sweep prueft erneut`,
    );
  }
}

// Read-only Preis-/Verfuegbarkeitssuche: liefert den ersten Kandidaten (mit seinem
// Provider-Preis, falls die Antwort ihn traegt). R5: 0 Treffer -> kontrollierter Fehler
// (NICHT Crash). Jeder Fehlschlag setzt die Nummer auf 'failed'; ein Hold ist an dieser
// Stelle noch nicht gestellt, also gibt es auch nichts freizugeben.
async function findPurchasableNumber(state, numberId, { provisioner, countryCode, type }) {
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
    failNumber(state, numberId); // nichts gehalten -> nichts freizugeben
    throw err;
  }
}

// Fail-closed-Gate VOR jedem Provider-Call: ohne GEEIGNETE Zahlungsmethode kein Kauf und
// keine Preis-Suche. EINE Stelle, die tenantStripe liest (G5); der Hold bekommt das
// Ergebnis gereicht. Zwei getrennte Gruende, zwei getrennte Meldungen:
//   1. gar nichts hinterlegt - Meldung woertlich wie bisher (Bestandstest pinnt sie);
//   2. GP-P2 (Vorfall 11.09.2026): hinterlegt, aber ohne getrennte Autorisierung. Der
//      Mandant des Vorfalls trug eine Zahlungsmethode vom Typ 'link'; sie bezahlte das
//      Abo (4,99 EUR) und lehnte sechs Sekunden spaeter den 92-Cent-Hold ab. Dieser Fall
//      endete bisher NACH dem Geld-Call in einem generischen insufficient_funds - er endet
//      jetzt VOR jedem Anbieter-Kontakt, mit dem Typ als Grund. Unbekannter Typ (null,
//      jeder Bestands-Mandant ohne Backfill) faellt mit durch: Owner-Entscheidung
//      2026-09-11, Frage 5 - Unbekannt gilt als ungeeignet. Der Rueckweg ist GP-P3.
// Der Typ wird als Enum in die Meldung uebernommen, nicht als Freitext (GP-P1-Muster:
// Etikett=Wert); sie landet ueber den Orchestrator dauerhaft in job.lastError.
function requireTenantCard(state, numberId, tenantId) {
  const card = tenantStripe(state, tenantId);
  if (!card.customerId || !card.paymentMethodId) {
    failNumber(state, numberId);
    throw new Error(`provisionNumber: Tenant ${tenantId} hat kein hinterlegtes Zahlungsmittel`);
  }
  if (!isHoldCapablePaymentMethodType(card.paymentMethodType)) {
    failNumber(state, numberId);
    throw new Error(
      `provisionNumber: Tenant ${tenantId} hat ein Zahlungsmittel ohne getrennte Autorisierung ` +
        `(payment_method_type=${card.paymentMethodType ?? "unbekannt"})`,
    );
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
async function placeSetupFeeHold(
  state,
  numberId,
  { tenantId, billing, card, holdAmountCents, currency },
) {
  const exempt = tenantSubscription(state, tenantId).numberSetupFeeExempt;
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
    failNumber(state, numberId);
    throw holdErr;
  }
  attachNumberPaymentIntent(state, numberId, paymentIntentId);
  return { paymentIntentId, exempt };
}

// Schliesst den Setup-Hold ab: Einzug (regulaer) ODER Storno (befreit, GAP-05). Beides
// laeuft ueber DIESELBE Fehlerkante (rollbackAfterOrder beim Aufrufer) - ein gescheiterter
// Abschluss darf nie eine bezahlte/gehaltene Waise hinterlassen (G5, kein zweiter
// Rollback-Pfad).
async function settleSetupFeeHold(
  state,
  numberId,
  { billing, paymentIntentId, holdAmountCents, exempt },
) {
  beginCapturing(state, numberId); // provisioning -> capturing (Geld-Abschluss laeuft)
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
  state,
  numberId,
  { provisioner, providerNumberId, e164, tenantId, billing, paymentIntentId, logger },
) {
  failNumber(state, numberId); // provisioning|capturing -> failed
  if (e164 && numberBusyReason(state, { e164 }, { forTenantId: tenantId })) {
    logger.warn(
      `provisionNumber: releaseNumber uebersprungen (Plattform-Bindung) -> Orphan, Reconcile noetig ` +
        `(number=${numberId} provider=${providerNumberId})`,
    );
    await cancelHoldIfHeld(billing, paymentIntentId);
    return;
  }
  try {
    await provisioner.releaseNumber(providerNumberId);
    releaseNumber(state, numberId); // failed -> released (Provider-Nummer sauber weg)
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
