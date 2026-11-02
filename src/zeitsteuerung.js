import { SWEEP_TRIGGER } from "./billing/cost-truing.js";

export function runSweepTick({ costTruing, provisioning, costCrossCheck, outageWatch, paidWithoutNumberWatch, provisionRetryWatch, priceDriftWatch }) {
  void costTruing
    .runCostTruingSweep({ trigger: SWEEP_TRIGGER.INTERVAL })
    .catch((err) => console.error("[cost-truing]", err.message));
  void provisioning
    .settleDueNumberMonthMeters()
    .catch((err) => console.error("[number-month]", err.message));
  void costCrossCheck
    .runMonthlyCrossCheck()
    .catch((err) => console.error("[cost-cross-check]", err.message));
  void outageWatch
    .runRecoverySweep()
    .catch((err) => console.error("[outage-watch]", err.message));
  void outageWatch
    .runAlertChannelSelfTest()
    .catch((err) => console.error("[outage-watch]", err.message));
  void outageWatch
    .runHoldEscalationSweep()
    .catch((err) => console.error("[outage-watch]", err.message));
  void paidWithoutNumberWatch
    .runPaidWithoutNumberSweep()
    .catch((err) => console.error("[paid-no-number]", err.message));
  void provisionRetryWatch
    .runProvisionRetrySweep()
    .catch((err) => console.error("[provision-retry-sweep]", err.message));
  void priceDriftWatch
    .runPriceDriftSweep()
    .catch((err) => console.error("[price-drift]", err.message));
}
