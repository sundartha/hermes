import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite } from "./server-mit-testdatenbank.js";
import { echtWarten } from "../echt-warten.js";

const SWEEP_TAKT_MS = 60_000;
const WARTE_AUF_ABGLEICH_MS = 3000;
const POLL_TAKT_MS = 20;
const RUHEZEIT_OHNE_ABGLEICH_MS = 300;
const MELDUNG = "Abgleich fragt nicht den Vormonat ab";

process.env.COST_TRUING_SWEEP_INTERVAL_MS = String(SWEEP_TAKT_MS);
let sweepTakt = null;
const fabrikIntervall = mock.method(globalThis, "setInterval", (aufruf, takt) => {
  if (takt === SWEEP_TAKT_MS) sweepTakt = aufruf;
  return { unref() {} };
});
const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "postfach@abgleich.invalid", anrufstartAbgelehnt: true });
fabrikIntervall.mock.restore();
mock.timers.enable({ apis: ["Date"], now: Date.now() });
const store = await import("../../src/store.js");

async function sweepAm(jetztIso, bisherGeprueft) {
  laufendesHermes();
  store.load().costCrossCheck.lastCheckedMonthKey = bisherGeprueft;
  store.save();
  await store.drainFlushes();
  mock.timers.setTime(Date.parse(jetztIso));
  sweepTakt();
  for (let gewartet = 0; gewartet < WARTE_AUF_ABGLEICH_MS && store.load().costCrossCheck.lastCheckedMonthKey === bisherGeprueft; gewartet += POLL_TAKT_MS) {
    await echtWarten(POLL_TAKT_MS);
  }
  await echtWarten(RUHEZEIT_OHNE_ABGLEICH_MS);
  return store.load().costCrossCheck.lastCheckedMonthKey;
}

const FAELLIG = [
  ["01.06.2026 mit geprüftem April: Mai", "2026-06-01T12:00:00.000Z", "2026-04", "2026-05"],
  ["31.05.2026 mit geprüftem März: April, nie der Mai", "2026-05-31T12:00:00.000Z", "2026-03", "2026-04"],
  ["15.08.2026: Juli", "2026-08-15T12:00:00.000Z", "2026-06", "2026-07"],
  ["01.01.2027: Dezember 2026", "2027-01-01T12:00:00.000Z", "2026-11", "2026-12"],
  ["31.03.2026: Februar, nie der März", "2026-03-31T12:00:00.000Z", "2026-01", "2026-02"],
  ["30.03.2028 (Schaltjahr): Februar", "2028-03-30T12:00:00.000Z", "2028-01", "2028-02"],
  ["29.03.2028 (Schaltjahr): Februar", "2028-03-29T12:00:00.000Z", "2028-01", "2028-02"],
];

for (const [name, jetzt, bisher, erwartet] of FAELLIG) {
  test(`Kostenabgleich im Sweep-Takt, ${name}`, async () => {
    assert.equal(await sweepAm(jetzt, bisher), erwartet, MELDUNG);
  });
}

const NICHTS_FAELLIG = [
  ["31.05.2026 mit geprüftem April", "2026-05-31T12:00:00.000Z", "2026-04"],
  ["29.03.2026 mit geprüftem Februar", "2026-03-29T12:00:00.000Z", "2026-02"],
  ["15.08.2026 mit geprüftem Juli (kein zweites Mal)", "2026-08-15T12:00:00.000Z", "2026-07"],
];

for (const [name, jetzt, bisher] of NICHTS_FAELLIG) {
  test(`Kostenabgleich im Sweep-Takt, ${name}: nichts fällig`, async () => {
    assert.equal(await sweepAm(jetzt, bisher), bisher, MELDUNG);
  });
}
