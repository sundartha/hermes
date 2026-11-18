import assert from "node:assert/strict";
import { test } from "node:test";

import { makeFristenLauf } from "../../src/telephony/fristen-lauf.ts";

const TAKT_MS = 15000;
const LIMIT = 5;

function makeBetrieb({ beendenScheitert = false } = {}) {
  const betrieb = { lesenScheitert: true, beendet: [], gelesen: 0, fragen: 0 };
  const hier = [
    { id: "abgelaufen_a", status: "active", twilioSid: "CA_a" },
    { id: "abgelaufen_b", status: "active", twilioSid: "CA_b" },
  ];
  const store = {
    faelligeFristen: async () => {
      betrieb.gelesen += 1;
      if (betrieb.lesenScheitert) throw new Error("db nicht erreichbar");
      return [];
    },
    attachActiveCall: async () => null,
    getCall: () => null,
  };
  const beende = async (call) => {
    if (beendenScheitert) throw new Error("hangup weg");
    betrieb.beendet.push(call.id);
    call.status = "completed";
  };
  const abgelaufeneHier = () => {
    betrieb.fragen += 1;
    return hier.filter((call) => call.status === "active");
  };
  const lauf = makeFristenLauf({ store, beende, limitJeMandant: LIMIT, leaseMs: TAKT_MS, abgelaufeneHier });
  return { betrieb, lauf, hier };
}

function fehlerzeilen(t) {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  return zeilen;
}

test("Fristenlauf-Lesefehler: ein einzelner fehlgeschlagener Takt beendet keinen Anruf und steht im Log", async (t) => {
  const zeilen = fehlerzeilen(t);
  const { betrieb, lauf } = makeBetrieb();
  assert.deepEqual(await lauf.takt(), { beendet: 0, offen: 0, gelesen: false });
  assert.deepEqual(betrieb.beendet, []);
  assert.equal(betrieb.fragen, 0);
  assert.equal(zeilen.filter((zeile) => zeile.includes("faellige Fristen lesen fehlgeschlagen")).length, 1);
});

test("Fristenlauf-Lesefehler: nach dem zweiten fehlgeschlagenen Takt endet jeder hier gebundene abgelaufene Anruf", async (t) => {
  fehlerzeilen(t);
  const { betrieb, lauf } = makeBetrieb();
  await lauf.takt();
  const zweiter = await lauf.takt();
  assert.deepEqual(betrieb.beendet, ["abgelaufen_a", "abgelaufen_b"]);
  assert.deepEqual(zweiter, { beendet: 2, offen: 0, gelesen: false });
});

test("Fristenlauf-Lesefehler: ein gelungenes Lesen dazwischen setzt die Zaehlung zurueck", async (t) => {
  fehlerzeilen(t);
  const { betrieb, lauf } = makeBetrieb();
  await lauf.takt();
  betrieb.lesenScheitert = false;
  assert.deepEqual(await lauf.takt(), { beendet: 0, offen: 0, gelesen: true });
  betrieb.lesenScheitert = true;
  await lauf.takt();
  assert.deepEqual(betrieb.beendet, []);
  await lauf.takt();
  assert.deepEqual(betrieb.beendet, ["abgelaufen_a", "abgelaufen_b"]);
});

test("Fristenlauf-Lesefehler: scheitert das Beenden, steht der Fehler mit Anruf-ID im Log, der naechste fehlgeschlagene Takt versucht es erneut", async (t) => {
  const zeilen = fehlerzeilen(t);
  const { betrieb, lauf } = makeBetrieb({ beendenScheitert: true });
  await lauf.takt();
  const zweiter = await lauf.takt();
  assert.deepEqual(zweiter, { beendet: 0, offen: 2, gelesen: false });
  const beendenZeilen = zeilen.filter((zeile) => zeile.includes("Beenden fehlgeschlagen"));
  assert.equal(beendenZeilen.length, 2);
  assert.ok(beendenZeilen[0].includes("abgelaufen_a"));
  assert.ok(beendenZeilen[1].includes("abgelaufen_b"));
  assert.equal(betrieb.fragen, 1);
  await lauf.takt();
  assert.equal(betrieb.fragen, 2);
});

test("Fristenlauf-Lesefehler: ohne gebundene Anrufe passiert nach zwei Fehltakten nichts Weiteres", async (t) => {
  fehlerzeilen(t);
  const { betrieb, lauf, hier } = makeBetrieb();
  hier.length = 0;
  await lauf.takt();
  assert.deepEqual(await lauf.takt(), { beendet: 0, offen: 0, gelesen: false });
  assert.deepEqual(betrieb.beendet, []);
});

test("Fristenlauf-Lesefehler: ohne Angabe der gebundenen Anrufe laeuft der Takt wie bisher", async (t) => {
  fehlerzeilen(t);
  const { betrieb } = makeBetrieb();
  const lauf = makeFristenLauf({
    store: { faelligeFristen: async () => { throw new Error("weg"); }, attachActiveCall: async () => null, getCall: () => null },
    beende: async (call) => betrieb.beendet.push(call.id),
    limitJeMandant: LIMIT,
    leaseMs: TAKT_MS,
  });
  await lauf.takt();
  assert.deepEqual(await lauf.takt(), { beendet: 0, offen: 0, gelesen: false });
});
