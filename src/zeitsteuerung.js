import { SWEEP_TRIGGER } from "./billing/cost-truing.ts";
import { MS_PER_MINUTE } from "./utils/timer.js";

const MINUTES_PER_HOUR = 60;
const RETENTION_SWEEP_INTERVAL_HOURS = 6;
const RETENTION_SWEEP_NAME = "aufbewahrung";
const RETENTION_SWEEP_INTERVAL_MS = RETENTION_SWEEP_INTERVAL_HOURS * MINUTES_PER_HOUR * MS_PER_MINUTE;

export async function starteAufbewahrung(aufraeumen, zeitplan) {
  aufraeumen();
  await zeitplan.plane(RETENTION_SWEEP_NAME, RETENTION_SWEEP_INTERVAL_MS, aufraeumen);
}

const TEILLAEUFE = [
  { name: "cost-truing", logTag: "[cost-truing]", lauf: (w) => w.costTruing.runCostTruingSweep({ trigger: SWEEP_TRIGGER.INTERVAL }) },
  { name: "number-month", logTag: "[number-month]", lauf: (w) => w.provisioning.settleDueNumberMonthMeters() },
  { name: "cost-cross-check", logTag: "[cost-cross-check]", lauf: (w) => w.costCrossCheck.runMonthlyCrossCheck() },
  { name: "outage-recovery", logTag: "[outage-watch]", lauf: (w) => w.outageWatch.runRecoverySweep() },
  { name: "outage-selftest", logTag: "[outage-watch]", lauf: (w) => w.outageWatch.runAlertChannelSelfTest() },
  { name: "outage-hold-escalation", logTag: "[outage-watch]", lauf: (w) => w.outageWatch.runHoldEscalationSweep() },
  { name: "paid-without-number", logTag: "[paid-no-number]", lauf: (w) => w.paidWithoutNumberWatch.runPaidWithoutNumberSweep() },
  { name: "provision-retry", logTag: "[provision-retry-sweep]", lauf: (w) => w.provisionRetryWatch.runProvisionRetrySweep() },
  { name: "price-drift", logTag: "[price-drift]", lauf: (w) => w.priceDriftWatch.runPriceDriftSweep() },
];

export async function starteSweepTakt(config, waechter, zeitplan) {
  for (const { name, logTag, lauf } of TEILLAEUFE)
    await zeitplan.plane(name, config.billing.costTruingSweepIntervalMs, {
      lauf: async () => lauf(waechter),
      beiFehler: (err) => console.error(logTag, err.message),
    });
}

export function runSweepTick(waechter) {
  for (const { logTag, lauf } of TEILLAEUFE) void lauf(waechter).catch((err) => console.error(logTag, err.message));
}
