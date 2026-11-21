import { SWEEP_TRIGGER } from "./billing/cost-truing.ts";
import { starteFristenTakt as starteFristenTaktMitUhr } from "./telephony/fristen-lauf.ts";
import { MS_PER_MINUTE } from "./utils/timer.ts";

const MINUTES_PER_HOUR = 60;
const RETENTION_SWEEP_INTERVAL_HOURS = 6;
const RETENTION_SWEEP_NAME = "aufbewahrung";
const RETENTION_SWEEP_INTERVAL_MS = RETENTION_SWEEP_INTERVAL_HOURS * MINUTES_PER_HOUR * MS_PER_MINUTE;

export async function starteAufbewahrung(aufraeumen, zeitplan) {
  await aufraeumen();
  await zeitplan.plane(RETENTION_SWEEP_NAME, RETENTION_SWEEP_INTERVAL_MS, aufraeumen);
}

const TEILLAEUFE = [
  { name: "cost-truing", logTag: "[cost-truing]", lauf: (wachen) => wachen.costTruing.runCostTruingSweep({ trigger: SWEEP_TRIGGER.INTERVAL }) },
  { name: "number-month", logTag: "[number-month]", lauf: (wachen) => wachen.provisioning.settleDueNumberMonthMeters() },
  { name: "cost-cross-check", logTag: "[cost-cross-check]", lauf: (wachen) => wachen.costCrossCheck.runMonthlyCrossCheck() },
  { name: "outage-recovery", logTag: "[outage-watch]", lauf: (wachen) => wachen.outageWatch.runRecoverySweep() },
  { name: "outage-selftest", logTag: "[outage-watch]", lauf: (wachen) => wachen.outageWatch.runAlertChannelSelfTest() },
  { name: "outage-hold-escalation", logTag: "[outage-watch]", lauf: (wachen) => wachen.outageWatch.runHoldEscalationSweep() },
  { name: "paid-without-number", logTag: "[paid-no-number]", lauf: (wachen) => wachen.paidWithoutNumberWatch.runPaidWithoutNumberSweep() },
  { name: "provision-retry", logTag: "[provision-retry-sweep]", lauf: (wachen) => wachen.provisionRetryWatch.runProvisionRetrySweep() },
  { name: "price-drift", logTag: "[price-drift]", lauf: (wachen) => wachen.priceDriftWatch.runPriceDriftSweep() },
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

export function starteFristenTakt({ store, lifecycle, config, fristen, abfrage, uebergabe }) {
  const geldWacheMs = config.safety.budgetWatchdogIntervalMs;
  return starteFristenTaktMitUhr({
    store,
    beende: lifecycle.terminateExpiredCall,
    abgelaufeneHier: lifecycle.abgelaufeneAktive,
    geld:
      geldWacheMs > 0
        ? {
            intervalMs: geldWacheMs,
            jetzt: Date.now,
            blockingAxisFor: lifecycle.blockingAxisFor,
            beende: lifecycle.terminateOverBudgetExpired,
          }
        : undefined,
    reserve: { freigeben: (call) => lifecycle.releaseReserve(call, { wirfBeiFehler: true }) },
    abfrage,
    uebergabe,
    limitJeMandant: fristen.fristenLimitJeMandant,
    leaseMs: fristen.fristenTaktMs,
    taktMs: fristen.fristenTaktMs,
    uhr: { setzeTakt: setInterval, loescheTakt: clearInterval },
  });
}
