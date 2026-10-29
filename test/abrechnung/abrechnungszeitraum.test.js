import { test } from "node:test";
import assert from "node:assert/strict";
import { MS_PER_SECOND, periodStartFromEnd } from "../../src/billing/period.js";

const MS_PER_SECOND_EXPECTED = 1000;
const END_SEC = Date.parse("2026-07-15T00:00:00.000Z") / MS_PER_SECOND_EXPECTED;
const EXPECTED_START_SEC = Date.parse("2026-06-15T00:00:00.000Z") / MS_PER_SECOND_EXPECTED;
const END_MAR_31_SEC = Date.parse("2026-03-31T00:00:00.000Z") / MS_PER_SECOND_EXPECTED;

test("MS_PER_SECOND ist die kanonische s<->ms-Bruecke", () => {
  assert.equal(MS_PER_SECOND, MS_PER_SECOND_EXPECTED);
});

test("beide Wrapper-Formate meinen denselben Zeitpunkt (ISO == Sekunden)", () => {
  const start = periodStartFromEnd(END_SEC);
  const iso = start.toISOString();
  const sec = Math.floor(start.getTime() / MS_PER_SECOND);
  assert.equal(sec, EXPECTED_START_SEC, "Sekunden-Form = Backfill-Erwartung");
  assert.equal(new Date(sec * MS_PER_SECOND).toISOString(), iso, "ISO und Sekunden konsistent");
});

test("Monatsletzter: Beginn bleibt im Vormonat, begrenzt auf dessen letzten Tag", () => {
  assert.equal(periodStartFromEnd(END_MAR_31_SEC).toISOString(), "2026-02-28T00:00:00.000Z");
});

const unterZeitzone = (zone, pruefung) => {
  const vorher = process.env.TZ;
  process.env.TZ = zone;
  try {
    pruefung();
  } finally {
    if (vorher === undefined) delete process.env.TZ;
    else process.env.TZ = vorher;
  }
};

const sekundenAus = (iso) => Date.parse(iso) / MS_PER_SECOND_EXPECTED;
const isoBeginnAusEnde = (endeIso) => periodStartFromEnd(sekundenAus(endeIso)).toISOString();

const ENDE_ZU_BEGINN_MIT_UHRZEIT = [
  ["2027-07-15T08:45:00.000Z", "2027-06-15T08:45:00.000Z"],
  ["2027-03-29T22:10:00.000Z", "2027-02-28T22:10:00.000Z"],
  ["2027-03-30T01:00:00.000Z", "2027-02-28T01:00:00.000Z"],
  ["2027-03-31T23:59:00.000Z", "2027-02-28T23:59:00.000Z"],
  ["2028-03-30T00:30:00.000Z", "2028-02-29T00:30:00.000Z"],
  ["2027-05-31T12:00:00.000Z", "2027-04-30T12:00:00.000Z"],
  ["2027-01-31T23:00:00.000Z", "2026-12-31T23:00:00.000Z"],
  ["2027-10-31T00:15:00.000Z", "2027-09-30T00:15:00.000Z"],
];

const ZEITZONEN = ["UTC", "Europe/Berlin", "Pacific/Kiritimati", "America/Los_Angeles"];

test("[NIE1] Beginn ist derselbe Tag im Vormonat, hoechstens dessen Letzter, mit gleicher UTC-Uhrzeit in jeder Zeitzone", () => {
  for (const zone of ZEITZONEN) {
    unterZeitzone(zone, () => {
      for (const [ende, beginn] of ENDE_ZU_BEGINN_MIT_UHRZEIT) {
        assert.equal(isoBeginnAusEnde(ende), beginn, `Ende ${ende} unter TZ=${zone}`);
      }
    });
  }
});

test("[NIE2] gespeicherter Periodenbeginn hat Vorrang vor dem aus dem Ende abgeleiteten", async () => {
  const { resolvePeriodStartIso } = await import("../../src/billing/period.js");
  const ende = sekundenAus("2027-03-31T00:00:00.000Z");
  assert.equal(
    resolvePeriodStartIso({
      currentPeriodStart: sekundenAus("2027-03-10T06:00:00.000Z"),
      currentPeriodEnd: ende,
    }),
    "2027-03-10T06:00:00.000Z",
  );
  assert.equal(
    resolvePeriodStartIso({ currentPeriodStart: null, currentPeriodEnd: ende }),
    "2027-02-28T00:00:00.000Z",
  );
});

test("[NIE3] MS_PER_SECOND und resolvePeriodStartIso bleiben aus src/billing/period.js importierbar", async () => {
  const modul = await import("../../src/billing/period.js");
  assert.equal(modul.MS_PER_SECOND, MS_PER_SECOND_EXPECTED);
  assert.equal(typeof modul.resolvePeriodStartIso, "function");
  assert.equal(modul.resolvePeriodStartIso({}), null);
});

test("[NIE4] Ende mit Uhrzeit und Sekunden behaelt sie im Beginn, auch unter TZ=Europe/Berlin", () => {
  unterZeitzone("Europe/Berlin", () => {
    assert.equal(isoBeginnAusEnde("2027-07-15T14:23:17Z"), "2027-06-15T14:23:17.000Z");
    assert.equal(isoBeginnAusEnde("2027-03-31T23:30:45Z"), "2027-02-28T23:30:45.000Z");
    assert.equal(isoBeginnAusEnde("2028-03-31T09:05:59Z"), "2028-02-29T09:05:59.000Z");
  });
});
