import { test } from "node:test";
import assert from "node:assert/strict";

const FEHLT = "Cannot find module";
const ladeHelfer = () =>
  import("../../src/utils/month.js").catch((fehler) => assert.fail(`${FEHLT}: ${fehler.message}`));
const ladeHelferOderNull = () => import("../../src/utils/month.js").catch(() => null);
const iso = (wert) => wert.toISOString();

const EINEN_MONAT_ZURUECK = [
  ["2027-03-31T00:00:00.000Z", "2027-02-28T00:00:00.000Z"],
  ["2028-03-31T00:00:00.000Z", "2028-02-29T00:00:00.000Z"],
  ["2027-05-31T00:00:00.000Z", "2027-04-30T00:00:00.000Z"],
  ["2027-03-30T00:00:00.000Z", "2027-02-28T00:00:00.000Z"],
  ["2028-02-29T00:00:00.000Z", "2028-01-29T00:00:00.000Z"],
  ["2029-01-15T00:00:00.000Z", "2028-12-15T00:00:00.000Z"],
  ["2027-07-15T14:23:17.000Z", "2027-06-15T14:23:17.000Z"],
  ["2027-03-31T23:30:45.000Z", "2027-02-28T23:30:45.000Z"],
  ["2028-03-31T09:05:59.000Z", "2028-02-29T09:05:59.000Z"],
  ["2027-03-28T14:23:17.000Z", "2027-02-28T14:23:17.000Z"],
  ["2029-01-31T14:23:17.000Z", "2028-12-31T14:23:17.000Z"],
];

const VORMONATSBEGINN = [
  ["2029-01-15T14:23:17.000Z", "2028-12-01T00:00:00.000Z"],
  ["2027-03-31T14:23:17.000Z", "2027-02-01T00:00:00.000Z"],
  ["2028-03-29T14:23:17.000Z", "2028-02-01T00:00:00.000Z"],
  ["2027-08-30T23:59:59.000Z", "2027-07-01T00:00:00.000Z"],
];

const MONATSLETZTER = [
  ["2027-02-10T12:00:00Z", "2027-02-28T00:00:00.000Z"],
  ["2028-02-10T12:00:00Z", "2028-02-29T00:00:00.000Z"],
  ["2027-04-05T14:23:17Z", "2027-04-30T00:00:00.000Z"],
  ["2027-06-30T23:59:59Z", "2027-06-30T00:00:00.000Z"],
  ["2027-09-01T00:00:00Z", "2027-09-30T00:00:00.000Z"],
  ["2027-11-15T10:00:00Z", "2027-11-30T00:00:00.000Z"],
  ["2027-01-31T10:00:00Z", "2027-01-31T00:00:00.000Z"],
  ["2027-03-01T10:00:00Z", "2027-03-31T00:00:00.000Z"],
  ["2027-05-20T10:00:00Z", "2027-05-31T00:00:00.000Z"],
  ["2027-07-20T10:00:00Z", "2027-07-31T00:00:00.000Z"],
  ["2027-08-20T10:00:00Z", "2027-08-31T00:00:00.000Z"],
  ["2027-10-20T10:00:00Z", "2027-10-31T00:00:00.000Z"],
  ["2027-12-20T10:00:00Z", "2027-12-31T00:00:00.000Z"],
];

const ZEITZONEN = ["UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago"];
const SCHLUESSEL = [
  ["2029-01-01T00:30:00Z", "2029-01"],
  ["2028-12-31T23:30:00Z", "2028-12"],
  ["2027-09-15T12:00:00Z", "2027-09"],
];

const mitZeitzone = (zone, aktion) => {
  const urspruenglich = process.env.TZ;
  process.env.TZ = zone;
  try {
    aktion();
  } finally {
    if (urspruenglich === undefined) delete process.env.TZ;
    else process.env.TZ = urspruenglich;
  }
};

const pruefeTabelle = (funktion, tabelle) => {
  for (const [eingabe, erwartet] of tabelle) {
    assert.equal(iso(funktion(new Date(eingabe))), erwartet, eingabe);
  }
};

test("oneMonthBack: Tabelle mit Kappung am Monatsende, Uhrzeit bleibt, Januar springt in den Dezember", async () => {
  const { oneMonthBack } = await ladeHelfer();
  pruefeTabelle(oneMonthBack, EINEN_MONAT_ZURUECK);
});

test("previousMonthStart: 1. des Vormonats 00:00 UTC, Januar springt in den Dezember des Vorjahres", async () => {
  const { previousMonthStart } = await ladeHelfer();
  pruefeTabelle(previousMonthStart, VORMONATSBEGINN);
});

test("lastDayOfMonth: Date auf 00:00 UTC des letzten Tages, Februar je nach Schaltjahr", async () => {
  const { lastDayOfMonth } = await ladeHelfer();
  for (const [eingabe, erwartet] of MONATSLETZTER) {
    const ergebnis = lastDayOfMonth(new Date(eingabe));
    assert.ok(ergebnis instanceof Date, eingabe);
    assert.equal(iso(ergebnis), erwartet, eingabe);
  }
});

test("yearMonthKey: zweistellige Monate in UTC, auch bei verschobener lokaler Zeitzone", async () => {
  const { yearMonthKey } = await ladeHelfer();
  for (const zone of ZEITZONEN) {
    mitZeitzone(zone, () => {
      for (const [eingabe, erwartet] of SCHLUESSEL) {
        assert.equal(yearMonthKey(new Date(eingabe)), erwartet, `${zone} ${eingabe}`);
      }
    });
  }
});

test("[NIE1] oneMonthBack kappt den Tag auf den Vormonatsletzten und lässt die Uhrzeit stehen", async () => {
  const helfer = await ladeHelferOderNull();
  if (!helfer) return;
  pruefeTabelle(helfer.oneMonthBack, EINEN_MONAT_ZURUECK.slice(0, 5));
});

test("[NIE2] oneMonthBack und previousMonthStart springen im Januar in den Dezember des Vorjahres", async () => {
  const helfer = await ladeHelferOderNull();
  if (!helfer) return;
  assert.equal(iso(helfer.oneMonthBack(new Date("2029-01-15T00:00:00Z"))), "2028-12-15T00:00:00.000Z");
  assert.equal(iso(helfer.previousMonthStart(new Date("2029-01-15T00:00:00Z"))), "2028-12-01T00:00:00.000Z");
});

test("[NIE3] lastDayOfMonth liefert ein Date auf 00:00 UTC des letzten Tages", async () => {
  const helfer = await ladeHelferOderNull();
  if (!helfer) return;
  for (const [eingabe, erwartet] of MONATSLETZTER) {
    const ergebnis = helfer.lastDayOfMonth(new Date(eingabe));
    assert.ok(ergebnis instanceof Date, eingabe);
    assert.equal(iso(ergebnis), erwartet, eingabe);
  }
});

test("[NIE4] yearMonthKey liefert zweistellige Monate in UTC unabhängig von der Zeitzone", async () => {
  const helfer = await ladeHelferOderNull();
  if (!helfer) return;
  for (const zone of ZEITZONEN) {
    mitZeitzone(zone, () => {
      for (const [eingabe, erwartet] of SCHLUESSEL) {
        assert.equal(helfer.yearMonthKey(new Date(eingabe)), erwartet, `${zone} ${eingabe}`);
      }
    });
  }
});

test("[NIE5] keine Funktion liest die Uhr und keine verändert das übergebene Date", async () => {
  const helfer = await ladeHelferOderNull();
  if (!helfer) return;
  const EINGABE_ISO = "2027-03-31T14:23:17.000Z";
  const uhrZeiger = Date.now;
  Date.now = () => assert.fail("Date.now gelesen");
  try {
    for (const name of ["oneMonthBack", "previousMonthStart", "lastDayOfMonth", "yearMonthKey"]) {
      const eingabe = new Date(EINGABE_ISO);
      helfer[name](eingabe);
      assert.equal(iso(eingabe), EINGABE_ISO, name);
    }
  } finally {
    Date.now = uhrZeiger;
  }
});

test("[NIE6] keine weiteren Exporte als die vier Funktionen", async () => {
  const helfer = await ladeHelferOderNull();
  if (!helfer) return;
  assert.deepEqual(Object.keys(helfer).sort(), [
    "lastDayOfMonth",
    "oneMonthBack",
    "previousMonthStart",
    "yearMonthKey",
  ]);
});

test("[NIE7] oneMonthBack behält Uhrzeit und Sekunden", async () => {
  const helfer = await ladeHelferOderNull();
  if (!helfer) return;
  pruefeTabelle(helfer.oneMonthBack, EINEN_MONAT_ZURUECK.slice(6, 9));
});
