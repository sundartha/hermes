// Billing-Port (P6b1): Provider-unabhaengiger Vertrag fuer "Geld halten,
// dann erst provisionieren" (Stripe manual capture). Reine JSDoc-Typdefs.
// Domaenensprache: KEIN Stripe-Objekt verlaesst den Adapter (nur paymentIntentId
// als opaker String). Money-Betraege als GANZZAHL Cents (G26: Geld nie als Float).

/**
 * @typedef {Object} HoldParams
 * @property {string} tenantRef       - Tenant, fuer den gehalten wird (Audit/Metadata)
 * @property {number} amountCents      - Betrag in GANZZAHL Cents (>0)
 * @property {string} currency         - ISO-4217 lowercase (z.B. "eur")
 * @property {string} customerId       - opake Stripe-Customer-Referenz (cus_...): Karte am Customer
 * @property {string} paymentMethodId  - opake payment_method-Referenz (pm_...): off_session belastbar
 * @property {string} idempotencyKey   - number-id-basiert ('hold_'+numberId): Retry haelt nie doppelt
 */

/**
 * @typedef {Object} HoldResult
 * @property {string} paymentIntentId  - opake Provider-Referenz (Stripe pi_...); KEIN Stripe-Objekt
 */

/**
 * @typedef {Object} SetupCheckoutParams
 * @property {string} tenantRef    - Tenant, fuer den die Karte erfasst wird (Audit/Metadata)
 * @property {string} customerId   - opake Stripe-Customer-Referenz (cus_...)
 * @property {string} successUrl   - Redirect nach erfolgreicher Karten-Erfassung
 * @property {string} cancelUrl    - Redirect bei Abbruch
 */

/**
 * @typedef {Object} SetupCheckoutResult
 * @property {string} url        - Stripe-gehostete Checkout-URL (Redirect-Ziel); KEIN Stripe-Objekt
 * @property {string} sessionId  - opake Checkout-Session-Referenz (cs_...)
 */

/**
 * @typedef {Object} SubscriptionCheckoutParams
 * @property {string} tenantRef       - Tenant, fuer den Karte+Abo erfasst werden (Audit/Metadata)
 * @property {string} customerId      - opake Stripe-Customer-Referenz (cus_...)
 * @property {string} priceId         - opake recurring Stripe-Price-Referenz (price_...)
 * @property {string} planSlug        - Katalog-Slug; reist als subscription_data-Metadata in die Subscription
 * @property {string} successUrl      - Redirect nach erfolgreichem Abschluss
 * @property {string} cancelUrl       - Redirect bei Abbruch
 * @property {string} idempotencyKey  - tenant+plan+price-basiert ('subcs_'+tenant+'_'+plan+'_'+price):
 *   ein Doppelklick/zwei Tabs bekommen DIESELBE Session, nie zwei echte Stripe-Abos (TOCTOU-
 *   Schutz); ein geaenderter Stripe-Price erzeugt einen NEUEN Key (kein idempotency_error)
 */

/**
 * @typedef {Object} SubscriptionCheckoutResult
 * @property {string} url        - Stripe-gehostete Checkout-URL (Redirect-Ziel); KEIN Stripe-Objekt
 * @property {string} sessionId  - opake Checkout-Session-Referenz (cs_...)
 */

/**
 * @typedef {Object} SubscriptionCheckoutOutcome
 * @property {string} customerId          - opake Stripe-Customer-Referenz (cus_...)
 * @property {string} paymentMethodId     - opake payment_method-Referenz (pm_...)
 * @property {string|null} paymentMethodType - Stripe-Enum der Zahlungsmethode ('card', 'link', ...); unexpandierte Antwort -> null
 * @property {string} subscriptionId      - opake Stripe-Subscription-Referenz (sub_...)
 * @property {number} currentPeriodStart  - Beginn der laufenden Abrechnungsperiode (Unix-Sekunden)
 * @property {number} currentPeriodEnd    - Ende der laufenden Abrechnungsperiode (Unix-Sekunden)
 * @property {string|null} planSlug       - Katalog-Slug aus der Subscription-Metadata (fehlt -> null)
 */

/**
 * @typedef {Object} SubscribeParams
 * @property {string} tenantRef       - Tenant, fuer den das Abo erstellt wird (Audit/Metadata)
 * @property {string} customerId      - opake Stripe-Customer-Referenz (cus_...): traegt die Karte
 * @property {string} priceId         - opake recurring Stripe-Price-Referenz (price_...)
 * @property {string} idempotencyKey  - tenant+plan-basiert ('sub_'+tenant+'_'+plan): Retry legt nie zwei Abos an
 */

/**
 * @typedef {Object} SubscribeResult
 * @property {string} subscriptionId      - opake Stripe-Subscription-Referenz (sub_...); KEIN Stripe-Objekt
 * @property {number} currentPeriodEnd     - Ende der laufenden Abrechnungsperiode (Unix-Sekunden)
 * @property {number} currentPeriodStart   - Beginn der laufenden Abrechnungsperiode (Unix-Sekunden)
 */

/**
 * @typedef {Object} SubscriptionAmountCheck
 * @property {string|null} planSlug         - Katalog-Slug aus der Subscription-Metadata (fehlt -> null)
 * @property {boolean} numberSetupFeeExempt - true NUR wenn das aktuelle Invoice-total nachweislich 0 ist (unbekannt -> false, fail-closed)
 * @property {string|null} status           - Abo-Status laut Stripe (opak, z.B. "active"/"canceled"; fehlt -> null, nie raten).
 *   Genutzt vom Stripe-Abgleich-Sweep (billing/stripe-reconcile.js), um verlorene
 *   customer.subscription.deleted-Webhooks zu erkennen und zu heilen.
 */

/**
 * @typedef {Object} SubscriptionCancellationParams
 * @property {string} subscriptionId  - opake Stripe-Subscription-Referenz (sub_...)
 * @property {string} idempotencyKey  - subscriptionId+Richtung-basiert ('cancel_sched_'+subscriptionId
 *   bzw. 'cancel_unsched_'+subscriptionId, s. scheduleCancellation/unscheduleCancellation weiter
 *   unten): ein Doppelklick auf DENSELBEN Vorgang bekommt DENSELBEN Key (Stripe haelt nie
 *   doppelt); ein spaeterer ECHTER Gegenteil-Vorgang (Kunde nimmt zurueck, kuendigt dann
 *   erneut) traegt die JEWEILS ANDERE Richtung im Key und geht damit durch (Muster
 *   'subcs_'+tenant+'_'+plan+'_'+price: die Richtung ist Teil des Schluessels, nicht nur
 *   die Ressourcen-ID).
 */

/**
 * @typedef {Object} SubscriptionCancellationResult
 * @property {string} subscriptionId     - opake Stripe-Subscription-Referenz (sub_...); KEIN Stripe-Objekt
 * @property {boolean} cancelAtPeriodEnd - Zustand NACH dem Patch (true=vorgemerkt, false=zurueckgenommen)
 * @property {number} currentPeriodEnd   - Ende der laufenden Abrechnungsperiode (Unix-Sekunden) - der
 *   Aufrufer kennt Zustand UND Termin aus EINER Antwort, ohne erneut retrieveSubscription
 *   nachfragen zu muessen
 */

/**
 * @typedef {Object} CheckoutResult
 * @property {string} customerId       - opake Stripe-Customer-Referenz (cus_...)
 * @property {string} paymentMethodId  - opake payment_method-Referenz (pm_...)
 * @property {string|null} paymentMethodType - Stripe-Enum der Zahlungsmethode ('card', 'link', ...); unexpandierte Antwort -> null
 */

/**
 * @typedef {Object} MeterReport
 * @property {string} tenantRef       - Tenant, fuer den gemeldet wird (Stripe-Customer-Achse)
 * @property {string} kind            - Meter-Typ (USAGE_EVENT_KIND: voice_minute|ai_token|number_month)
 * @property {number} quantity        - aggregierte Menge (Minuten/Tokens/Nummern-Monate)
 * @property {number} costCents       - aggregierte Kosten in GANZZAHL Cents (Audit/Abgleich)
 * @property {string} idempotencyKey  - stabil je Aggregat: Stripe-Retry meldet nie doppelt
 */

/**
 * @typedef {Object} BillingPort
 * @property {(params: HoldParams) => Promise<HoldResult>} placeHold
 *   Reserviert Geld OHNE Einzug (Stripe PaymentIntent capture_method=manual).
 * @property {(paymentIntentId: string, amountCents: number) => Promise<void>} captureHold
 *   Zieht den zuvor reservierten Betrag ein (Stripe capture). Aufruf NUR direkt vor
 *   der Aktivierung (kein active ohne Capture).
 * @property {(paymentIntentId: string) => Promise<void>} cancelHold
 *   Gibt eine Reservierung frei (Stripe cancel) - Rollback, wenn die Nummer nicht kommt.
 * @property {(report: MeterReport) => Promise<void>} reportMeter
 *   Meldet EIN aggregiertes Meter-Event an den Provider (Stripe Meter Events API).
 *   Idempotent ueber idempotencyKey. Loest KEIN Geld aus (nur usage-Reporting).
 * @property {(params: { tenantRef: string }) => Promise<{ customerId: string }>} createCustomer
 *   Legt einen Stripe-Customer fuer den Tenant an (POST /v1/customers). Loest KEIN Geld aus.
 * @property {(params: SetupCheckoutParams) => Promise<SetupCheckoutResult>} createSetupCheckoutSession
 *   Erzeugt eine Stripe-Checkout-Session im setup-Mode (Karte speichern OHNE Abbuchung).
 * @property {(sessionId: string) => Promise<CheckoutResult>} getCheckoutSessionResult
 *   Liest customer + payment_method aus einer abgeschlossenen Setup-Session.
 * @property {(params: SubscriptionCheckoutParams) => Promise<SubscriptionCheckoutResult>} createSubscriptionCheckoutSession
 *   Erzeugt eine Stripe-Checkout-Session im subscription-Mode: Karte + Abo in EINEM
 *   gehosteten Schritt, inkl. nativem Rabattcode-Feld (allow_promotion_codes). Loest
 *   bei Abschluss ECHTES Geld aus (Stripe legt das Abo an) - nur payment-gegated rufen.
 * @property {(sessionId: string) => Promise<SubscriptionCheckoutOutcome>} getSubscriptionCheckoutResult
 *   Liest customer + payment_method + Abo-Referenzen aus einer ABGESCHLOSSENEN
 *   subscription-Session. Fehlt die Subscription oder das payment_method -> wirft
 *   (fail-closed, Muster getCheckoutSessionResult). KEIN Stripe-Objekt verlaesst den Adapter.
 * @property {(paymentMethodId: string) => Promise<string|null>} retrievePaymentMethodType
 *   GP-P2: liest NUR den Enum-Typ einer gespeicherten Zahlungsmethode (rein lesend, kein
 *   Geld). Gebraucht vom Webhook-Bindepfad, dessen Ereignis den Typ nie traegt. KEIN
 *   Stripe-Objekt verlaesst den Adapter (billing_details bleiben drinnen).
 * @property {(params: SubscribeParams) => Promise<SubscribeResult>} createSubscription
 *   Erstellt ein echtes monatliches Recurring (Stripe POST /v1/subscriptions). Loest
 *   ECHTES Geld aus (Erstzahlung off_session). Nur subscriptionId + currentPeriodEnd +
 *   currentPeriodStart verlassen den Adapter (KEIN Stripe-Objekt).
 * @property {(subscriptionId: string) => Promise<SubscriptionAmountCheck>} retrieveSubscription
 *   Liest Plan-Slug + Fix-B-Hold-Befreiung eines BESTEHENDEN Abos (GET, expand latest_invoice).
 *   Genutzt vom A3-Reconcile-Backfill UND von activation.js (syncNumberSetupFeeExemption).
 * @property {(params: SubscriptionCancellationParams) => Promise<SubscriptionCancellationResult>} scheduleCancellation
 *   312k-P2: vermerkt am BESTEHENDEN Stripe-Abo "kuendigt zum Periodenende" (PATCH
 *   cancel_at_period_end=true, POST /v1/subscriptions/{id}). Loest KEIN Geld aus und
 *   aendert am Abo selbst NICHTS Physisches - der Tenant bleibt bis currentPeriodEnd
 *   bedient (Owner-Entscheidung 312k: Kuendigung wirkt zum Ende des bezahlten Zeitraums).
 *   NICHT zu verwechseln mit cancelHold (das storniert eine Zahlungsmittel-Reserve, kein Abo).
 * @property {(params: SubscriptionCancellationParams) => Promise<SubscriptionCancellationResult>} unscheduleCancellation
 *   312k-P2: nimmt eine zuvor vermerkte Kuendigung zurueck (PATCH cancel_at_period_end=false) -
 *   DIESELBE Stripe-Operation wie scheduleCancellation, nur mit umgekehrtem Wert. Billig zu
 *   haben (identischer Call, ein Flag) und erspart jeden Support-Fall "ich habe mir das anders
 *   ueberlegt". Aktiviert NICHTS neu (der Tenant war ohnehin aktiv, s. webhook.js
 *   CANCEL_SCHEDULED).
 */
export {};
