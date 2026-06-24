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
 * @typedef {Object} SubscribeParams
 * @property {string} tenantRef       - Tenant, fuer den das Abo erstellt wird (Audit/Metadata)
 * @property {string} customerId      - opake Stripe-Customer-Referenz (cus_...): traegt die Karte
 * @property {string} priceId         - opake recurring Stripe-Price-Referenz (price_...)
 * @property {string} idempotencyKey  - tenant+plan-basiert ('sub_'+tenant+'_'+plan): Retry legt nie zwei Abos an
 */

/**
 * @typedef {Object} SubscribeResult
 * @property {string} subscriptionId    - opake Stripe-Subscription-Referenz (sub_...); KEIN Stripe-Objekt
 * @property {number} currentPeriodEnd  - Ende der laufenden Abrechnungsperiode (Unix-Sekunden)
 */

/**
 * @typedef {Object} CheckoutResult
 * @property {string} customerId       - opake Stripe-Customer-Referenz (cus_...)
 * @property {string} paymentMethodId  - opake payment_method-Referenz (pm_...)
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
 * @property {(params: SubscribeParams) => Promise<SubscribeResult>} createSubscription
 *   Erstellt ein echtes monatliches Recurring (Stripe POST /v1/subscriptions). Loest
 *   ECHTES Geld aus (Erstzahlung off_session). Nur subscriptionId + currentPeriodEnd
 *   verlassen den Adapter (KEIN Stripe-Objekt).
 */
export {};
