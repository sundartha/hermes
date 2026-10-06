export const PLAN_CATALOG = Object.freeze([
  Object.freeze({
    slug: "starter",
    name: "Starter",
    amountCents: 499,
    currency: "eur",
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
    name: "Pro",
    amountCents: 999,
    currency: "eur",
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

export function formatPlanPrice(amountCents, currency, lang) {
  const major = Math.floor(amountCents / CENTS_PER_MAJOR);
  const minor = String(amountCents % CENTS_PER_MAJOR).padStart(2, "0");
  if (currency === "eur" && lang !== "en") {
    return `${major},${minor} €`;
  }
  return `${CURRENCY_SYMBOLS[currency] || ""}${major}.${minor}`;
}

export function findPlan(slug) {
  return PLAN_CATALOG.find((p) => p.slug === slug) ?? null;
}
