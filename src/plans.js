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

export const CATALOG_SLUGS = Object.freeze(PLAN_CATALOG.map((p) => p.slug));

export function isKnownPlanSlug(slug) {
  return CATALOG_SLUGS.includes(slug);
}

export function findPlan(slug) {
  return PLAN_CATALOG.find((p) => p.slug === slug) ?? null;
}

const PAID_PLAN_PROFILE = Object.freeze({
  allowedNumbers: Object.freeze([]),
  allowedCountryCodes: Object.freeze([]),
  unrestricted: false,
  allowCalendar: false,
  allowConsult: true,
  allowLookup: false,
  allowBooking: false,
  maxCallsPerHour: null,
});

export const PLAN_PROFILE = Object.freeze({
  starter: PAID_PLAN_PROFILE,
  business: PAID_PLAN_PROFILE,
});

export function planProfileFor(slug) {
  return PLAN_PROFILE[slug] ?? null;
}
