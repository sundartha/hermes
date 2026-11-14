import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOutageWatch } from "../../src/telephony/outage-report.js";
import { makePaidWithoutNumberWatch } from "../../src/billing/paid-without-number-watch.ts";
import { makeProvisionRetryWatch } from "../../src/billing/provision-retry-sweep.ts";
import { makePriceDriftWatch } from "../../src/billing/price-drift-watch.ts";
import { runSweepTick } from "../../src/boot.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

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

import { mock } from "node:test";
import { neueUhr, pgBossUmgebung } from "../gemeinsam/pgboss-umgebung.js";
import { starteSweepTakt } from "../../src/boot.js";
import { createQueue } from "../../src/queue/registry.js";
import { config } from "../../src/config.js";
import { makeConfigOverrides } from "../helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const MINUTE_MS = 60_000;
const STUNDE_MS = 60 * MINUTE_MS;

const TEILLAEUFE = [
  { name: "cost-truing", zweig: "costTruing", methode: "runCostTruingSweep", logTag: "[cost-truing]" },
  { name: "number-month", zweig: "provisioning", methode: "settleDueNumberMonthMeters", logTag: "[number-month]" },
  { name: "cost-cross-check", zweig: "costCrossCheck", methode: "runMonthlyCrossCheck", logTag: "[cost-cross-check]" },
  { name: "outage-recovery", zweig: "outageWatch", methode: "runRecoverySweep", logTag: "[outage-watch]" },
  { name: "outage-selftest", zweig: "outageWatch", methode: "runAlertChannelSelfTest", logTag: "[outage-watch]" },
  { name: "outage-hold-escalation", zweig: "outageWatch", methode: "runHoldEscalationSweep", logTag: "[outage-watch]" },
  { name: "paid-without-number", zweig: "paidWithoutNumberWatch", methode: "runPaidWithoutNumberSweep", logTag: "[paid-no-number]" },
  { name: "provision-retry", zweig: "provisionRetryWatch", methode: "runProvisionRetrySweep", logTag: "[provision-retry-sweep]" },
  { name: "price-drift", zweig: "priceDriftWatch", methode: "runPriceDriftSweep", logTag: "[price-drift]" },
];

function wachen(aufrufe, fehlerBei) {
  const zweige = {};
  for (const { zweig, methode } of TEILLAEUFE) {
    zweige[zweig] ??= {};
    zweige[zweig][methode] = async (...argumente) => {
      aufrufe.push({ methode, argumente });
      if (methode === fehlerBei) throw new Error(`${methode}-kaputt`);
      return {};
    };
  }
  return zweige;
}

const konfiguration = (intervallMs) => ({ billing: { costTruingSweepIntervalMs: intervallMs } });

function aufzeichnung() {
  const plaene = [];
  return {
    plaene,
    plane: async (name, intervallMs, lauf) => {
      plaene.push({ name, intervallMs, lauf });
    },
  };
}

const anzahl = (aufrufe, methode) => aufrufe.filter((a) => a.methode === methode).length;

test("Sweep-Takt-1: der Sweep-Takt meldet neun benannte Zeitpläne mit dem Takt aus der Konfiguration an und führt beim Anmelden nichts aus", async () => {
  const aufrufe = [];
  const zeitplan = aufzeichnung();
  await starteSweepTakt(konfiguration(STUNDE_MS), wachen(aufrufe), zeitplan);
  assert.deepEqual(zeitplan.plaene.map((p) => p.name), TEILLAEUFE.map((t) => t.name));
  for (const p of zeitplan.plaene) assert.equal(p.intervallMs, STUNDE_MS, p.name);
  assert.deepEqual(aufrufe, []);
});

test("Sweep-Takt-2: jeder Zeitplan ruft genau seinen Teillauf, der Kostenabgleich mit dem Auslöser des Takts", async () => {
  const aufrufe = [];
  const zeitplan = aufzeichnung();
  await starteSweepTakt(konfiguration(STUNDE_MS), wachen(aufrufe), zeitplan);
  for (const { name, methode } of TEILLAEUFE) {
    const eintrag = zeitplan.plaene.find((p) => p.name === name);
    await (eintrag.lauf.lauf ?? eintrag.lauf)();
    assert.equal(anzahl(aufrufe, methode), 1, name);
  }
  assert.equal(aufrufe.length, TEILLAEUFE.length);
  assert.deepEqual(aufrufe[0].argumente, [{ trigger: "interval" }]);
});

test("Sweep-Takt-3: scheitert ein Teillauf, bleibt sein Log-Kennzeichen erhalten und der Fehler geht an den Zeitplan weiter", async () => {
  for (const { name, methode, logTag } of TEILLAEUFE) {
    const zeitplan = aufzeichnung();
    await starteSweepTakt(konfiguration(STUNDE_MS), wachen([], methode), zeitplan);
    const { lauf, beiFehler } = zeitplan.plaene.find((p) => p.name === name).lauf;
    const meldungen = mock.method(console, "error", () => {});
    try {
      await assert.rejects(lauf(), new RegExp(`${methode}-kaputt`));
      beiFehler(new Error("x"));
      assert.deepEqual(meldungen.mock.calls.map((c) => c.arguments), [[logTag, "x"]], name);
    } finally {
      meldungen.mock.restore();
    }
  }
});

test("Sweep-Takt-4: mit memory laufen alle neun Teilläufe je Takt einmal im Prozess und nicht beim Anmelden", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const aufrufe = [];
  const queue = withConfigOverrides({ queueBackend: "memory" }, () => createQueue());
  await starteSweepTakt(konfiguration(STUNDE_MS), wachen(aufrufe), queue);
  assert.equal(aufrufe.length, 0);
  t.mock.timers.tick(STUNDE_MS - 1);
  assert.equal(aufrufe.length, 0);
  t.mock.timers.tick(1);
  assert.equal(aufrufe.length, TEILLAEUFE.length);
  for (const { methode } of TEILLAEUFE) assert.equal(anzahl(aufrufe, methode), 1, methode);
  t.mock.timers.tick(STUNDE_MS);
  assert.equal(aufrufe.length, 2 * TEILLAEUFE.length);
});

async function zweiInstanzen(t) {
  const clock = neueUhr();
  const { queue, weitereQueue } = await pgBossUmgebung(t, { clock });
  const aufrufe = [];
  await starteSweepTakt(konfiguration(STUNDE_MS), wachen(aufrufe), queue);
  await starteSweepTakt(konfiguration(STUNDE_MS), wachen(aufrufe), weitereQueue());
  return { clock, aufrufe, queue };
}

test("Sweep-Takt-5: mit pgboss und zwei Instanzen läuft jeder der neun Teilläufe je Takt genau einmal", async (t) => {
  const { clock, aufrufe } = await zweiInstanzen(t);
  await clock.setTime(clock.now() + 2 * STUNDE_MS);
  await clock.tick(2 * MINUTE_MS);
  assert.equal(aufrufe.length, TEILLAEUFE.length);
  for (const { methode } of TEILLAEUFE) assert.equal(anzahl(aufrufe, methode), 1, methode);
});

test("Sweep-Takt-6: nach erfolgreichen Läufen ist kein Teillauf überfällig, ohne Läufe nach Takt plus Reserve alle neun", async (t) => {
  const { clock, queue } = await zweiInstanzen(t);
  await clock.setTime(clock.now() + 2 * STUNDE_MS);
  await clock.tick(2 * MINUTE_MS);
  assert.deepEqual(await queue.ueberfaellige(), []);
  await clock.setTime(clock.now() + 10 * STUNDE_MS);
  assert.equal((await queue.ueberfaellige()).length, TEILLAEUFE.length);
});
