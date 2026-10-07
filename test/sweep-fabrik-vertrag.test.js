import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOutageWatch } from "../src/telephony/outage-report.js";
import { makePaidWithoutNumberWatch } from "../src/billing/paid-without-number-watch.js";
import { makeProvisionRetryWatch } from "../src/billing/provision-retry-sweep.js";
import { makePriceDriftWatch } from "../src/billing/price-drift-watch.js";
import { runSweepTick } from "../src/boot.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

function fakeDeps() {
  return {
    store: {
      load: () => ({ outageAlerts: [], calls: [], platformNumberUse: [] }),
      save: () => {},
      withStoreLock: (fn) => fn(),
    },
    config: withConfigNamespaces({
      outageAlertWindowMs: 0,
      outageAlertSelfTestIntervalMs: 0,
      platformHoldEscalationMaxAgeMs: 0,
    }),
    audit: () => {},
    messaging: () => ({}),
    mailer: { sendMail: async () => {} },
  };
}

test("Z-A4: runSweepTick mit einer Fabrik-Rueckgabe, der eine Methode fehlt, WIRFT SYNCHRON (der Produktionsschaden, ausgefuehrt statt behauptet)", () => {
  const vollstaendigesOutageWatch = makeOutageWatch(fakeDeps());
  const unvollstaendigesOutageWatch = { ...vollstaendigesOutageWatch };
  delete unvollstaendigesOutageWatch.runHoldEscalationSweep;
  assert.throws(
    () =>
      runSweepTick({
        costTruing: { runCostTruingSweep: async () => ({}) },
        provisioning: { settleDueNumberMonthMeters: async () => ({}) },
        costCrossCheck: { runMonthlyCrossCheck: async () => ({}) },
        outageWatch: unvollstaendigesOutageWatch,
      }),
    /runHoldEscalationSweep is not a function/,
    "ein fehlender Zweig muss runSweepTick SYNCHRON zum Werfen bringen - genau der Produktionsschaden, den GP-1 belegt",
  );
});

function aufzeichnend(fabrikErgebnis, watchName, gerufen) {
  return new Proxy(fabrikErgebnis, {
    get(ziel, methode) {
      if (typeof ziel[methode] !== "function") return undefined;
      return async () => {
        gerufen.add(`${watchName}.${String(methode)}`);
      };
    },
  });
}

test("Z-A8: runSweepTick laeuft mit den echten Rueckgaben aller vier Wachen-Fabriken durch und ruft jede Wache", () => {
  const gerufen = new Set();
  const outageWatch = makeOutageWatch(fakeDeps());
  const paidWithoutNumberWatch = makePaidWithoutNumberWatch({
    store: fakeDeps().store,
    config: withConfigNamespaces({ paidWithoutNumberGraceMs: 0 }),
    audit: () => {},
  });
  const provisionRetryWatch = makeProvisionRetryWatch({
    store: fakeDeps().store,
    config: withConfigNamespaces({ provisioningRetryMinIntervalMs: 0, provisioningRetryMaxAttempts: 0 }),
    provision: async () => {},
    audit: () => {},
  });
  const priceDriftWatch = makePriceDriftWatch({
    ...fakeDeps(),
    config: withConfigNamespaces({ paymentEnabled: false, priceDriftMinIntervalMs: 0 }),
    lesePreis: async () => ({}),
  });
  const uebrigeLaeufe = {
    costCrossCheck: { runMonthlyCrossCheck: async () => ({}) },
    provisioning: { settleDueNumberMonthMeters: async () => ({}) },
    costTruing: { runCostTruingSweep: async () => ({}) },
  };
  assert.doesNotThrow(() =>
    runSweepTick({
      ...uebrigeLaeufe,
      outageWatch: aufzeichnend(outageWatch, "outageWatch", gerufen),
      paidWithoutNumberWatch: aufzeichnend(paidWithoutNumberWatch, "paidWithoutNumberWatch", gerufen),
      provisionRetryWatch: aufzeichnend(provisionRetryWatch, "provisionRetryWatch", gerufen),
      priceDriftWatch: aufzeichnend(priceDriftWatch, "priceDriftWatch", gerufen),
    }),
  );
  assert.deepEqual([...gerufen].sort(), [
    "outageWatch.runAlertChannelSelfTest",
    "outageWatch.runHoldEscalationSweep",
    "outageWatch.runRecoverySweep",
    "paidWithoutNumberWatch.runPaidWithoutNumberSweep",
    "priceDriftWatch.runPriceDriftSweep",
    "provisionRetryWatch.runProvisionRetrySweep",
  ]);
});
