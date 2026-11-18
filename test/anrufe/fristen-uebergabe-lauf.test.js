import assert from "node:assert/strict";
import { test } from "node:test";
import { makeFristenLauf, starteFristenTakt } from "../../src/telephony/fristen-lauf.ts";

const TAKT_MS = 15000;
const LIMIT = 5;
const ANRUF = "call_uebergabe";
const MANDANT = "tenant_uebergabe";

function makeBetrieb() {
  const betrieb = { geholt: [], umgeleitet: [], geleert: [], lesenScheitert: false, umleitenScheitert: false, leerenScheitert: false, keinTreffer: false };
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
    setzeUebergabeFrist: async (frist) => {
      if (betrieb.leerenScheitert) throw new Error("schreiben verweigert");
      betrieb.geleert.push(frist);
    },
  };
  const uebergabe = {
    umleiten: async (callId) => {
      if (betrieb.umleitenScheitert) throw new Error("umleiten verweigert");
      betrieb.umgeleitet.push(callId);
    },
  };
  const lauf = (zusatz = {}) => makeFristenLauf({ store, beende: async () => {}, limitJeMandant: LIMIT, leaseMs: TAKT_MS, uebergabe, ...zusatz });
  return { betrieb, store, uebergabe, lauf };
}

async function mitFehlerzeilen(t, body) {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  await body();
  return zeilen.filter((zeile) => zeile.startsWith("[fristen]"));
}

test("Uebergabe-Lauf: eine faellige Uebergabe leitet den Anruf um und leert die Frist, der Takt liest die Art uebergabe mit Limit und Lease", async () => {
  const { betrieb, lauf } = makeBetrieb();
  assert.deepEqual(await lauf().uebergabeTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.geholt, [{ art: "uebergabe", limitJeMandant: LIMIT, leaseMs: TAKT_MS }]);
  assert.deepEqual(betrieb.umgeleitet, [ANRUF]);
  assert.deepEqual(betrieb.geleert, [{ callId: ANRUF, tenantId: MANDANT, faelligAt: null }]);
});

test("Uebergabe-Lauf: die anderen Runden lesen keine Uebergabe-Fristen und leiten nichts um", async () => {
  const { betrieb, lauf } = makeBetrieb();
  await lauf().takt();
  await lauf().geldTakt();
  await lauf().reserveTakt();
  await lauf().abfrageTakt();
  assert.deepEqual(betrieb.geholt.map((anfrage) => anfrage.art), ["hoechstdauer"]);
  assert.deepEqual(betrieb.umgeleitet, []);
});

test("Uebergabe-Lauf: ohne Uebergabe-Verdrahtung liest der Takt keine Uebergabe-Fristen", async () => {
  const { betrieb, lauf } = makeBetrieb();
  assert.deepEqual(await lauf({ uebergabe: undefined }).uebergabeTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.geholt, []);
});

test("Uebergabe-Lauf: ohne faellige Zeile passiert nichts", async () => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.keinTreffer = true;
  assert.deepEqual(await lauf().uebergabeTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.umgeleitet, []);
  assert.deepEqual(betrieb.geleert, []);
});

test("Uebergabe-Lauf: ein Lesefehler steht im Log, der Takt meldet ihn und leitet nichts um", async (t) => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.lesenScheitert = true;
  let ergebnis;
  const zeilen = await mitFehlerzeilen(t, async () => {
    ergebnis = await lauf().uebergabeTakt();
  });
  assert.deepEqual(ergebnis, { beendet: 0, offen: 0, gelesen: false });
  assert.deepEqual(zeilen, ["[fristen] Takt: faellige Fristen lesen fehlgeschlagen: db nicht erreichbar"]);
  assert.deepEqual(betrieb.umgeleitet, []);
});

test("Uebergabe-Lauf: scheitert das Umleiten, steht der Fehler mit Anruf-ID im Log, die Frist bleibt stehen und ab dem dritten Versuch kommt die Meldung", async (t) => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.umleitenScheitert = true;
  const eins = lauf();
  const zeilen = await mitFehlerzeilen(t, async () => {
    for (let versuch = 1; versuch <= 3; versuch++) assert.deepEqual(await eins.uebergabeTakt(), { beendet: 0, offen: 1, gelesen: true });
  });
  assert.deepEqual(zeilen, [
    "[fristen] Uebergabe umleiten fehlgeschlagen: call_uebergabe Error: umleiten verweigert",
    "[fristen] Uebergabe umleiten fehlgeschlagen: call_uebergabe Error: umleiten verweigert",
    "[fristen] Uebergabe umleiten fehlgeschlagen: call_uebergabe Error: umleiten verweigert",
    "[fristen] Beenden nach 3 Versuchen nicht gelungen: call_uebergabe",
  ]);
  assert.deepEqual(betrieb.geleert, []);
});

test("Uebergabe-Lauf: scheitert nur das Leeren der Frist, bleibt die Zeile offen", async (t) => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.leerenScheitert = true;
  let ergebnis;
  const zeilen = await mitFehlerzeilen(t, async () => {
    ergebnis = await lauf().uebergabeTakt();
  });
  assert.deepEqual(ergebnis, { beendet: 0, offen: 1, gelesen: true });
  assert.deepEqual(zeilen, ["[fristen] Uebergabe umleiten fehlgeschlagen: call_uebergabe Error: schreiben verweigert"]);
});

test("Fristentakt: ein Takt ruft nach Hoechstdauer, Geld, Reserve und Abfrage auch die Uebergabe-Runde, auch wenn eine frueher fehlschlaegt", async (t) => {
  const { betrieb, store, uebergabe } = makeBetrieb();
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
  starteFristenTakt({ store, beende: async () => {}, limitJeMandant: LIMIT, leaseMs: TAKT_MS, taktMs: TAKT_MS, uhr, uebergabe, abfrage: { pollen: async () => {} }, reserve: { freigeben: () => {} } });
  handles[0].aufgabe();
  await new Promise((erfuellen) => setImmediate(erfuellen));
  assert.deepEqual(betrieb.geholt.map((anfrage) => anfrage.art), ["hoechstdauer", "reserve", "abfrage", "uebergabe"]);
});
