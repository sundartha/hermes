import { createHash } from "node:crypto";

const AXIS_SEPARATOR = "|";

export function configFingerprint(config) {
  const axes = [
    config.safety.allowedCountryCodes.join(","),
    config.safety.maxCallsPerHour,
    config.billing.budgetMonthEnabled,
    config.tenancy.multiTenant,
    config.billing.paymentCurrency,
    config.billing.platformSpendCapCents,
    config.billing.defaultTenantBudgetCents,
  ];
  return createHash("sha256").update(axes.join(AXIS_SEPARATOR)).digest("hex");
}
