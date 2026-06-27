// Plan-Katalog = Single Source of Truth fuer die buchbaren Tarife (Preise +
// Leistungen). Reines Daten-Modul: KEINE Imports, kein config, kein IO -> kein
// Lazy-Init (P15), keine Kopplung. Wird vom oeffentlichen GET /api/plans
// geliefert und von der Slug-Quelle in billing/subscribe.js konsumiert.
//
// SPIEGEL-PFLICHT (Deploy-Isolation): apps/web/src/lib/plans.js ist eine 1:1-
// physische Kopie dieser Daten. Grund: render.yaml deployt den Gateway-Service
// nur bei src/-Commits und die Static-Site (hermes-web) nur bei apps/web/-
// Commits (eigene Lockfile, eigenes npm-Paket). EIN importierter File koennte
// nie beide Services deployen -> ein Preis-Edit liesse die Marketing-Seite stale.
// Divergenz der beiden Kopien ist ein roter Build (test/plans-catalog.test.js).
//
// amountCents = der ANGEZEIGTE Preis (Ganzzahl Cents, G26 - kein Float). Der
// tatsaechliche Abbuch laeuft ueber den Stripe-Price (STRIPE_*_PRICE_ID); ihre
// Uebereinstimmung ist Owner-Verantwortung - dieser Katalog liest Stripe NICHT.
export const PLAN_CATALOG = Object.freeze([
  Object.freeze({
    slug: "starter",
    name: "Starter",
    amountCents: 499,
    currency: "usd",
    cadence: "month",
    includedMinutes: 30,
    numberCount: 1,
    featured: false,
    features: Object.freeze([
      "30 minutes of calls per month",
      "1 phone number",
      "Answer and summarise calls",
      "Call history in your area",
    ]),
  }),
  Object.freeze({
    slug: "business",
    name: "Business",
    amountCents: 999,
    currency: "usd",
    cadence: "month",
    includedMinutes: 120,
    numberCount: 1,
    featured: true,
    features: Object.freeze([
      "120 minutes of calls per month",
      "1 phone number",
      "Outgoing calls on your behalf",
      "Priority support",
    ]),
  }),
]);

// Buchbare Slugs in Katalog-Reihenfolge (eingefroren). EINE Quelle fuer
// billing/subscribe.js (PLAN_SLUGS) - kein zweites Slug-Literal (G5/S2).
export const CATALOG_SLUGS = Object.freeze(PLAN_CATALOG.map((p) => p.slug));

// Katalog-Lookup nach Slug (BK4: includedMinutes der Minuten-Kontingent-Anzeige).
// Reiner Accessor - kapselt, dass der Katalog ein Array ist (G17/G36), kein .find
// verstreut beim Aufrufer. Unbekannter/leerer Slug -> null (Aufrufer zeigt Leerzustand).
export function findPlan(slug) {
  return PLAN_CATALOG.find((p) => p.slug === slug) ?? null;
}
