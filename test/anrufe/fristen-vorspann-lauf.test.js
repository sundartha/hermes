import assert from "node:assert/strict";
import { test } from "node:test";
import { makeFristenLauf, starteFristenTakt } from "../../src/telephony/fristen-lauf.ts";

const TAKT_MS = 15000;
const LIMIT = 5;
const ANRUF = "call_vorspann_takt";
const MANDANT = "tenant_vorspann_takt";

function makeBetrieb(frist = "wiedergabe") {
  const betrieb = { geholt: [], behandelt: [], geleert: [], lesenScheitert: false, behandelnScheitert: false, leerenScheitert: false, keinTreffer: false };
  const store = {
    faelligeFristen: async (anfrage) => {
      betrieb.geholt.push(anfrage);
      if (betrieb.lesenScheitert) throw new Error("db nicht erreichbar");
      if (betrieb.keinTreffer) return [];
      return [{ callId: ANRUF, tenantId: MANDANT, frist, faelligAt: "x", versuche: betrieb.geholt.length }];
    },
    attachActiveCall: async () => null,
    getCall: () => null,
    setzeGeldFrist: async () => {},
    setzeReserveFrist: async () => {},
    setzeUebergabeFrist: async () => {},
    leereVorspannFrist: async (anfrage) => {
      if (betrieb.leerenScheitert) throw new Error("schreiben verweigert");
      betrieb.geleert.push(anfrage);
    },
  };
  const vorspann = {
    bei: async (treffer) => {
      if (betrieb.behandelnScheitert) throw new Error("behandeln verweigert");
      betrieb.behandelt.push(treffer);
    },
  };
  const lauf = (zusatz = {}) => makeFristenLauf({ store, beende: async () => {}, limitJeMandant: LIMIT, leaseMs: TAKT_MS, vorspann, ...zusatz });
  return { betrieb, store, vorspann, lauf };
}

async function mitFehlerzeilen(t, body) {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  await body();
  return zeilen.filter((zeile) => zeile.startsWith("[fristen]"));
}

test("Vorspann-Lauf: eine faellige Frist wird behandelt und danach geleert, der Takt liest die Art vorspann mit Limit und Lease", async () => {
  const { betrieb, lauf } = makeBetrieb("elBein");
  assert.deepEqual(await lauf().vorspannTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.geholt, [{ art: "vorspann", limitJeMandant: LIMIT, leaseMs: TAKT_MS }]);
  assert.deepEqual(betrieb.behandelt, [{ callId: ANRUF, tenantId: MANDANT, frist: "elBein", faelligAt: "x", versuche: 1 }]);
  assert.deepEqual(betrieb.geleert, [{ callId: ANRUF, tenantId: MANDANT, frist: "elBein" }]);
});

test("Vorspann-Lauf: die anderen Runden lesen keine Vorspann-Fristen", async () => {
  const { betrieb, lauf } = makeBetrieb();
  await lauf().takt();
  await lauf().geldTakt();
  await lauf().uebergabeTakt();
  assert.deepEqual(betrieb.geholt.map((anfrage) => anfrage.art), ["hoechstdauer"]);
  assert.deepEqual(betrieb.behandelt, []);
});

test("Vorspann-Lauf: ohne Vorspann-Verdrahtung liest der Takt keine Vorspann-Fristen", async () => {
  const { betrieb, lauf } = makeBetrieb();
  assert.deepEqual(await lauf({ vorspann: undefined }).vorspannTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.geholt, []);
});

test("Vorspann-Lauf: ohne faellige Zeile passiert nichts", async () => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.keinTreffer = true;
  assert.deepEqual(await lauf().vorspannTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.behandelt, []);
  assert.deepEqual(betrieb.geleert, []);
});

test("Vorspann-Lauf: ein Lesefehler steht im Log, der Takt meldet ihn und behandelt nichts", async (t) => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.lesenScheitert = true;
  let ergebnis;
  const zeilen = await mitFehlerzeilen(t, async () => {
    ergebnis = await lauf().vorspannTakt();
  });
  assert.deepEqual(ergebnis, { beendet: 0, offen: 0, gelesen: false });
  assert.deepEqual(zeilen, ["[fristen] Takt: faellige Fristen lesen fehlgeschlagen: db nicht erreichbar"]);
  assert.deepEqual(betrieb.behandelt, []);
});

test("Vorspann-Lauf: scheitert das Behandeln, steht der Fehler mit Anruf-ID im Log, die Frist bleibt stehen und ab dem dritten Versuch kommt die Meldung", async (t) => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.behandelnScheitert = true;
  const eins = lauf();
  const zeilen = await mitFehlerzeilen(t, async () => {
    for (let versuch = 1; versuch <= 3; versuch++) assert.deepEqual(await eins.vorspannTakt(), { beendet: 0, offen: 1, gelesen: true });
  });
  assert.deepEqual(zeilen, [
    "[fristen] Vorspann-Frist behandeln fehlgeschlagen: call_vorspann_takt Error: behandeln verweigert",
    "[fristen] Vorspann-Frist behandeln fehlgeschlagen: call_vorspann_takt Error: behandeln verweigert",
    "[fristen] Vorspann-Frist behandeln fehlgeschlagen: call_vorspann_takt Error: behandeln verweigert",
    "[fristen] Beenden nach 3 Versuchen nicht gelungen: call_vorspann_takt",
  ]);
  assert.deepEqual(betrieb.geleert, []);
});

test("Vorspann-Lauf: scheitert nur das Leeren der Frist, bleibt die Zeile offen", async (t) => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.leerenScheitert = true;
  let ergebnis;
  const zeilen = await mitFehlerzeilen(t, async () => {
    ergebnis = await lauf().vorspannTakt();
  });
  assert.deepEqual(ergebnis, { beendet: 0, offen: 1, gelesen: true });
  assert.deepEqual(zeilen, ["[fristen] Vorspann-Frist behandeln fehlgeschlagen: call_vorspann_takt Error: schreiben verweigert"]);
});

test("Fristentakt: ein Takt ruft nach der Uebergabe auch die Vorspann-Runde, auch wenn eine frueher fehlschlaegt", async (t) => {
  const { betrieb, store, vorspann } = makeBetrieb();
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
  starteFristenTakt({ store, beende: async () => {}, limitJeMandant: LIMIT, leaseMs: TAKT_MS, taktMs: TAKT_MS, uhr, vorspann, uebergabe: { umleiten: async () => {} }, abfrage: { pollen: async () => {} }, reserve: { freigeben: () => {} } });
  handles[0].aufgabe();
  await new Promise((erfuellen) => setImmediate(erfuellen));
  assert.deepEqual(betrieb.geholt.map((anfrage) => anfrage.art), ["hoechstdauer", "reserve", "abfrage", "uebergabe", "vorspann"]);
});

function takt({ hierKaputt }) {
  const handles = [];
  const gelesen = [];
  const uhr = { setzeTakt: (aufgabe) => (handles.push(aufgabe), { unref: () => {} }), loescheTakt: () => {} };
  const store = {
    faelligeFristen: async (anfrage) => {
      gelesen.push(anfrage.art);
      if (anfrage.art === "hoechstdauer") throw new Error("db weg");
      return [];
    },
    attachActiveCall: async () => null,
    getCall: () => null,
    setzeGeldFrist: async () => {},
    setzeReserveFrist: async () => {},
    setzeUebergabeFrist: async () => {},
    leereVorspannFrist: async () => {},
  };
  const abgelaufeneHier = () => {
    if (hierKaputt) throw new Error("hier kaputt");
    return [];
  };
  starteFristenTakt({ store, beende: async () => {}, abgelaufeneHier, limitJeMandant: 1, leaseMs: 1, taktMs: 1, uhr, vorspann: { bei: async () => {} } });
  return { tick: handles[0], gelesen };
}

const nachRunde = () => new Promise((erfuellen) => setImmediate(erfuellen));

test("Fristentakt: laufen alle Runden ohne Abbruch, steht kein Abbruch im Log", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const { tick } = takt({ hierKaputt: false });
  tick();
  await nachRunde();
  tick();
  await nachRunde();
  assert.deepEqual(zeilen.filter((zeile) => zeile.startsWith("[fristen] Takt abgebrochen")), []);
});

test("Fristentakt: wirft die erste Runde, steht der Abbruch mit ihrem Fehler im Log und die Vorspann-Runde laeuft trotzdem", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const { tick, gelesen } = takt({ hierKaputt: true });
  tick();
  await nachRunde();
  tick();
  await nachRunde();
  assert.deepEqual(zeilen.filter((zeile) => zeile.startsWith("[fristen] Takt abgebrochen")), ["[fristen] Takt abgebrochen: Error: hier kaputt"]);
  assert.equal(gelesen.filter((art) => art === "vorspann").length, 2);
});
