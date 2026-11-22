import assert from "node:assert/strict";
import { test } from "node:test";
import { starteFristenTakt } from "../../src/telephony/fristen-lauf.ts";

const LIMIT = 5;
const LEASE_MS = 9000;

function aufbau({ abfrageLesen }) {
  const geholt = [];
  const store = {
    faelligeFristen: async ({ art }) => {
      geholt.push(art);
      if (art === "abfrage") return abfrageLesen();
      return [];
    },
    getCall: () => null,
    attachActiveCall: async () => null,
    setzeGeldFrist: async () => {},
    setzeReserveFrist: async () => {},
    setzeUebergabeFrist: async () => {},
  };
  const uhr = {
    gesetzt: [],
    setzeTakt(aufgabe, ms) {
      const handle = { aufgabe, ms, unref: () => {} };
      uhr.gesetzt.push(handle);
      return handle;
    },
    loescheTakt: () => {},
  };
  const geld = { intervalMs: 1000, jetzt: () => 0, blockingAxisFor: async () => false, beende: async () => {} };
  const start = () =>
    starteFristenTakt({
      store,
      beende: async () => {},
      limitJeMandant: LIMIT,
      leaseMs: LEASE_MS,
      taktMs: 1000,
      uhr,
      geld,
      reserve: { freigeben: async () => {} },
      abfrage: { pollen: async () => {} },
      uebergabe: { umleiten: async () => {} },
    });
  const tick = async () => {
    uhr.gesetzt[0].aufgabe();
    for (let i = 0; i < 20; i += 1) await new Promise((erfuellen) => setImmediate(erfuellen));
  };
  return { geholt, start, tick };
}

test("Abfrage-Runde haengt: im naechsten Takt laufen Hoechstdauer-, Geld-, Reserve- und Uebergabe-Runde trotzdem", async () => {
  const { geholt, start, tick } = aufbau({ abfrageLesen: () => new Promise(() => {}) });
  start();
  await tick();
  await tick();
  assert.deepEqual(geholt, [
    "hoechstdauer", "geld", "reserve", "abfrage", "uebergabe",
    "hoechstdauer", "geld", "reserve", "abfrage", "uebergabe",
  ]);
});

test("Abfrage-Runde scheitert: der Fehler steht im Log und die anderen Runden laufen weiter", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const { geholt, start, tick } = aufbau({
    abfrageLesen: () => {
      throw new Error("db weg");
    },
  });
  start();
  await tick();
  assert.ok(geholt.includes("uebergabe"));
  assert.ok(zeilen.some((zeile) => zeile.startsWith("[fristen] Takt: faellige Fristen lesen fehlgeschlagen: db weg")));
});

test("Abfrage-Runde bricht unerwartet ab: der Abbruch steht im Log, die anderen Runden laufen", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const { geholt, start, tick } = aufbau({
    abfrageLesen: () => ({
      map: () => {
        throw new Error("kaputt");
      },
    }),
  });
  start();
  await tick();
  assert.ok(geholt.includes("uebergabe"));
  assert.deepEqual(
    zeilen.filter((zeile) => zeile.startsWith("[fristen]")),
    ["[fristen] Abfrage-Runde abgebrochen: Error: kaputt"],
  );
});
