import assert from "node:assert/strict";
import { test } from "node:test";
import { makeFristenLauf, starteFristenTakt } from "../../src/telephony/fristen-lauf.ts";

const TAKT_MS = 15000;
const LIMIT = 5;
const ANRUF = "call_abfrage";
const MANDANT = "tenant_abfrage";

function makeBetrieb() {
  const betrieb = { geholt: [], gepollt: [], lesenScheitert: false, pollenScheitert: false, keinTreffer: false };
  const store = {
    faelligeFristen: async (anfrage) => {
      betrieb.geholt.push(anfrage);
      if (betrieb.lesenScheitert) throw new Error("db nicht erreichbar");
      if (betrieb.keinTreffer) return [];
      return [{ callId: ANRUF, tenantId: MANDANT, faelligAt: "x", versuche: betrieb.geholt.length }];
    },
    attachActiveCall: async () => null,
    getCall: () => null,
    setzeGeldFrist: async () => {},
    setzeReserveFrist: async () => {},
  };
  const abfrage = {
    pollen: async (callId) => {
      if (betrieb.pollenScheitert) throw new Error("pollen verweigert");
      betrieb.gepollt.push(callId);
    },
  };
  const lauf = (zusatz = {}) => makeFristenLauf({ store, beende: async () => {}, limitJeMandant: LIMIT, leaseMs: TAKT_MS, abfrage, ...zusatz });
  return { betrieb, store, abfrage, lauf };
}

async function mitFehlerzeilen(t, body) {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  await body();
  return zeilen.filter((zeile) => zeile.startsWith("[fristen]"));
}

test("Abfrage-Lauf: eine faellige Abfrage startet die Abfrage des Anrufs, der Takt liest die Art abfrage mit Limit und Lease", async () => {
  const { betrieb, lauf } = makeBetrieb();
  assert.deepEqual(await lauf().abfrageTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.geholt, [{ art: "abfrage", limitJeMandant: LIMIT, leaseMs: TAKT_MS }]);
  assert.deepEqual(betrieb.gepollt, [ANRUF]);
});

test("Abfrage-Lauf: die anderen Runden lesen keine Abfrage-Fristen und starten keine Abfrage", async () => {
  const { betrieb, lauf } = makeBetrieb();
  await lauf().takt();
  await lauf().geldTakt();
  await lauf().reserveTakt();
  assert.deepEqual(betrieb.geholt.map((anfrage) => anfrage.art), ["hoechstdauer"]);
  assert.deepEqual(betrieb.gepollt, []);
});

test("Abfrage-Lauf: ohne Abfrage-Verdrahtung liest der Takt keine Abfrage-Fristen", async () => {
  const { betrieb, lauf } = makeBetrieb();
  assert.deepEqual(await lauf({ abfrage: undefined }).abfrageTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.geholt, []);
});

test("Abfrage-Lauf: ohne faellige Zeile passiert nichts", async () => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.keinTreffer = true;
  assert.deepEqual(await lauf().abfrageTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.gepollt, []);
});

test("Abfrage-Lauf: ein Lesefehler steht im Log, der Takt meldet ihn und startet nichts", async (t) => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.lesenScheitert = true;
  let ergebnis;
  const zeilen = await mitFehlerzeilen(t, async () => {
    ergebnis = await lauf().abfrageTakt();
  });
  assert.deepEqual(ergebnis, { beendet: 0, offen: 0, gelesen: false });
  assert.deepEqual(zeilen, ["[fristen] Takt: faellige Fristen lesen fehlgeschlagen: db nicht erreichbar"]);
  assert.deepEqual(betrieb.gepollt, []);
});

test("Abfrage-Lauf: scheitert der Start, steht der Fehler mit Anruf-ID im Log, die Zeile bleibt offen und ab dem dritten Versuch kommt die Meldung", async (t) => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.pollenScheitert = true;
  const eins = lauf();
  const zeilen = await mitFehlerzeilen(t, async () => {
    for (let versuch = 1; versuch <= 3; versuch++) assert.deepEqual(await eins.abfrageTakt(), { beendet: 0, offen: 1, gelesen: true });
  });
  assert.deepEqual(zeilen, [
    "[fristen] Abfrage starten fehlgeschlagen: call_abfrage Error: pollen verweigert",
    "[fristen] Abfrage starten fehlgeschlagen: call_abfrage Error: pollen verweigert",
    "[fristen] Abfrage starten fehlgeschlagen: call_abfrage Error: pollen verweigert",
    "[fristen] Beenden nach 3 Versuchen nicht gelungen: call_abfrage",
  ]);
});

test("Fristentakt: ein Takt ruft nach Hoechstdauer, Geld und Reserve auch die Abfrage-Runde, auch wenn eine frueher fehlschlaegt", async (t) => {
  const { betrieb, store, abfrage } = makeBetrieb();
  const handles = [];
  const uhr = {
    setzeTakt: (aufgabe) => {
      const handle = { aufgabe, unref: () => {} };
      handles.push(handle);
      return handle;
    },
    loescheTakt: () => {},
  };
  t.mock.method(console, "error", () => {});
  betrieb.lesenScheitert = true;
  starteFristenTakt({ store, beende: async () => {}, limitJeMandant: LIMIT, leaseMs: TAKT_MS, taktMs: TAKT_MS, uhr, abfrage });
  handles[0].aufgabe();
  await new Promise((erfuellen) => setImmediate(erfuellen));
  assert.deepEqual(betrieb.geholt.map((anfrage) => anfrage.art), ["hoechstdauer", "abfrage"]);
});
