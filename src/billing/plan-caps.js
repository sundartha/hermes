import { findPlan } from "../plans.js";

const PLAN_CAP_HEADROOM = Object.freeze({
  starter: Object.freeze({ numerator: 5, denominator: 3 }),
  business: Object.freeze({ numerator: 5, denominator: 4 }),
});

export function planCapCents(planSlug, cfg) {
  const plan = findPlan(planSlug);
  const headroom = PLAN_CAP_HEADROOM[planSlug];
  if (!plan || !headroom) {
    throw new Error(`planCapCents: unbekannter Plan-Slug '${planSlug}' (kein Katalog-/Kopffreiheit-Eintrag)`);
  }
  return (plan.includedMinutes * cfg.voiceTariffDefaultCents * headroom.numerator) / headroom.denominator;
}

export function includedMinutesFor({ plan, subscription }) {
  if (subscription?.periodCreditRevoked) return 0;
  return plan?.includedMinutes;
}
