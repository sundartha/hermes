import { findPlan } from "../plans.js";

interface Headroom {
  numerator: number;
  denominator: number;
}

interface IncludedMinutesInput {
  plan?: { includedMinutes?: number } | null | undefined;
  subscription?: { periodCreditRevoked?: unknown } | null | undefined;
}

const PLAN_CAP_HEADROOM: Readonly<Record<string, Readonly<Headroom> | undefined>> = Object.freeze({
  starter: Object.freeze({ numerator: 5, denominator: 3 }),
  business: Object.freeze({ numerator: 5, denominator: 4 }),
});

export function planCapCents(planSlug: string, cfg: { voiceTariffDefaultCents: number }): number {
  const plan = findPlan(planSlug);
  const headroom = PLAN_CAP_HEADROOM[planSlug];
  if (!plan || !headroom) {
    throw new Error(`planCapCents: unbekannter Plan-Slug '${planSlug}' (kein Katalog-/Kopffreiheit-Eintrag)`);
  }
  return (plan.includedMinutes * cfg.voiceTariffDefaultCents * headroom.numerator) / headroom.denominator;
}

export function includedMinutesFor({ plan, subscription }: IncludedMinutesInput): number | undefined {
  if (subscription?.periodCreditRevoked) return 0;
  return plan?.includedMinutes;
}
