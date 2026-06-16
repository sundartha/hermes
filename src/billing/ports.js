// Billing-Port (P6b1): Provider-unabhaengiger Vertrag fuer "Geld halten,
// dann erst provisionieren" (Stripe manual capture). Reine JSDoc-Typdefs.
// Domaenensprache: KEIN Stripe-Objekt verlaesst den Adapter (nur paymentIntentId
// als opaker String). Money-Betraege als GANZZAHL Cents (G26: Geld nie als Float).

/**
 * @typedef {Object} HoldParams
 * @property {string} tenantRef       - Tenant, fuer den gehalten wird (Audit/Metadata)
 * @property {number} amountCents      - Betrag in GANZZAHL Cents (>0)
 * @property {string} currency         - ISO-4217 lowercase (z.B. "eur")
 * @property {string} idempotencyKey   - number-id-basiert ('hold_'+numberId): Retry haelt nie doppelt
 */

/**
 * @typedef {Object} HoldResult
 * @property {string} paymentIntentId  - opake Provider-Referenz (Stripe pi_...); KEIN Stripe-Objekt
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
 */
export {};
