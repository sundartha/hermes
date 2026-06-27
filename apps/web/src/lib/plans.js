// Marketing-Spiegel des Plan-Katalogs: 1:1-physische Kopie der Daten aus
// src/plans.js (SSoT). Physisch getrennt wegen Deploy-Isolation (render.yaml:
// Static-Site deployt nur bei apps/web/-Commits, Gateway nur bei src/-Commits;
// eigenes npm-Paket mit eigener Lockfile). Divergenz zwischen beiden Kopien ist
// ein roter Build (test/plans-catalog.test.js, der einzige Ort, der beide Pakete
// sieht). Bewusst KEIN import.meta.env hier - dieses Modul muss aus dem reinen
// Node-Test UND dem Astro-Build importierbar bleiben (anders als routes.js).
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

const CENTS_PER_MAJOR = 100;
const CURRENCY_SYMBOLS = Object.freeze({ eur: "€", usd: "$" });

// Formatiert GANZZAHL-Cents als Anzeige (kein Float, G26): 499 -> "$4.99",
// 99 -> "$0.99". Englische Marketing-Seite -> Punkt-Dezimaltrenner, Symbol
// vorangestellt. Unbekannte Waehrung -> ohne Symbol (fail-soft, nie Muell-Glyph).
export function formatPlanPrice(amountCents, currency) {
  const major = Math.floor(amountCents / CENTS_PER_MAJOR);
  const minor = String(amountCents % CENTS_PER_MAJOR).padStart(2, "0");
  return `${CURRENCY_SYMBOLS[currency] || ""}${major}.${minor}`;
}

// Katalog-Lookup nach Slug (1:1-Spiegel von src/plans.js findPlan). Reiner Accessor
// -- kapselt, dass der Katalog ein Array ist (G17/G36), kein verstreutes .find beim
// Aufrufer (lib/subscribe.js: Plan-Name fuer die Abo-Zeile). Unbekannter/leerer Slug
// -> null. Der Cross-Package-Drift-Guard (test/plans-catalog.test.js) vergleicht NUR
// die Katalog-DATEN -> diese zusaetzliche Funktion bricht ihn nicht.
export function findPlan(slug) {
  return PLAN_CATALOG.find((p) => p.slug === slug) ?? null;
}
