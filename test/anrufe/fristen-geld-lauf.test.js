import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFristenLauf, starteFristenTakt } from "../../src/telephony/fristen-lauf.ts";

const TAKT_MS = 15000;
const WACHE_MS = 20000;
const LIMIT = 5;
const JETZT_MS = 1_800_000_000_000;
const ANRUF = "call_geld";
const MANDANT = "tenant_geld";

function makeBetrieb({ gesperrt = false } = {}) {
  const betrieb = {
    status: "active",
    gesperrt,
    geholt: [],
    gefragt: [],
    beendet: [],
    gesetzt: [],
    lesenScheitert: false,
    beendenScheitert: false,
    setzenScheitert: false,
    beendenLaesstAktiv: false,
    keinTreffer: false,
  };
  const call = { id: ANRUF, tenantId: MANDANT, status: "active", twilioSid: "CA_geld" };
  const store = {
    faelligeFristen: async (anfrage) => {
      betrieb.geholt.push(anfrage);
      if (betrieb.lesenScheitert) throw new Error("db nicht erreichbar");
      if (betrieb.keinTreffer) return [];
      return [{ callId: ANRUF, tenantId: MANDANT, faelligAt: "x", versuche: betrieb.geholt.length }];
    },
    attachActiveCall: async () => (betrieb.status === "active" ? call : null),
    getCall: () => call,
    setzeGeldFrist: async (frist) => {
      if (betrieb.setzenScheitert) throw new Error("schreiben verweigert");
      betrieb.gesetzt.push(frist);
    },
  };
  const geld = {
    intervalMs: WACHE_MS,
    jetzt: () => JETZT_MS,
    blockingAxisFor: async (angefragt) => {
      betrieb.gefragt.push(angefragt);
      return betrieb.gesperrt ? "budget_tenant" : null;
    },
    beende: async (zuBeenden) => {
      if (betrieb.beendenScheitert) throw new Error("db weg");
      betrieb.beendet.push(zuBeenden.id);
      if (!betrieb.beendenLaesstAktiv) call.status = "completed";
    },
  };
  const lauf = (zusatz = {}) =>
    makeFristenLauf({ store, beende: async () => {}, limitJeMandant: LIMIT, leaseMs: TAKT_MS, geld, ...zusatz });
  return { betrieb, call, lauf, geld };
}

async function mitFehlerzeilen(t, body) {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  await body();
  return zeilen.filter((zeile) => zeile.startsWith("[fristen]"));
}

test("Geld-Lauf: ist die Kostendecke nicht erreicht, bleibt der Anruf und die naechste Pruefung steht eine Wache-Frist spaeter an der Zeile", async () => {
  const { betrieb, call, lauf } = makeBetrieb();
  assert.deepEqual(await lauf().geldTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.geholt, [{ art: "geld", limitJeMandant: LIMIT, leaseMs: TAKT_MS }]);
  assert.deepEqual(betrieb.gefragt, [call]);
  assert.deepEqual(betrieb.beendet, []);
  assert.deepEqual(betrieb.gesetzt, [
    { callId: ANRUF, tenantId: MANDANT, faelligAt: new Date(JETZT_MS + WACHE_MS).toISOString() },
  ]);
});

test("Geld-Lauf: ist die Kostendecke erreicht, wird der Anruf beendet und keine weitere Pruefung eingetragen", async () => {
  const { betrieb, lauf } = makeBetrieb({ gesperrt: true });
  assert.deepEqual(await lauf().geldTakt(), { beendet: 1, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.beendet, [ANRUF]);
  assert.deepEqual(betrieb.gesetzt, []);
});

test("Geld-Lauf: die Hoechstdauer-Runde beendet nichts wegen des Geldes und liest nur ihre eigene Art", async () => {
  const { betrieb, lauf } = makeBetrieb({ gesperrt: true });
  await lauf().takt();
  assert.deepEqual(betrieb.geholt.map((anfrage) => anfrage.art), ["hoechstdauer"]);
  assert.deepEqual(betrieb.gefragt, []);
  assert.deepEqual(betrieb.gesetzt, []);
});

test("Geld-Lauf: ohne Geld-Verdrahtung liest der Takt keine Geld-Fristen", async () => {
  const { betrieb, lauf } = makeBetrieb();
  assert.deepEqual(await lauf({ geld: undefined }).geldTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.geholt, []);
});

test("Geld-Lauf: ein in der Datenbank schon beendeter Anruf wird weder geprueft noch beendet", async () => {
  const { betrieb, lauf } = makeBetrieb({ gesperrt: true });
  betrieb.status = "completed";
  assert.deepEqual(await lauf().geldTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.gefragt, []);
  assert.deepEqual(betrieb.beendet, []);
  assert.deepEqual(betrieb.gesetzt, []);
});

test("Geld-Lauf: ohne faellige Zeile passiert nichts", async () => {
  const { betrieb, lauf } = makeBetrieb({ gesperrt: true });
  betrieb.keinTreffer = true;
  assert.deepEqual(await lauf().geldTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.gefragt, []);
});

test("Geld-Lauf: ein Lesefehler steht im Log, der Takt meldet ihn und beendet nichts", async (t) => {
  const { betrieb, lauf } = makeBetrieb({ gesperrt: true });
  betrieb.lesenScheitert = true;
  let ergebnis;
  const zeilen = await mitFehlerzeilen(t, async () => {
    ergebnis = await lauf().geldTakt();
  });
  assert.deepEqual(ergebnis, { beendet: 0, offen: 0, gelesen: false });
  assert.deepEqual(zeilen, ["[fristen] Takt: faellige Fristen lesen fehlgeschlagen: db nicht erreichbar"]);
  assert.deepEqual(betrieb.beendet, []);
});

test("Geld-Lauf: scheitert das Beenden, bleibt der Anruf offen, der Fehler steht mit Anruf-ID im Log und ab dem dritten Versuch die Meldung", async (t) => {
  const { betrieb, lauf } = makeBetrieb({ gesperrt: true });
  betrieb.beendenScheitert = true;
  const eins = lauf();
  const zeilen = await mitFehlerzeilen(t, async () => {
    for (let versuch = 1; versuch <= 3; versuch++) assert.deepEqual(await eins.geldTakt(), { beendet: 0, offen: 1, gelesen: true });
  });
  assert.deepEqual(zeilen, [
    "[fristen] Beenden fehlgeschlagen: call_geld Error: db weg",
    "[fristen] Beenden fehlgeschlagen: call_geld Error: db weg",
    "[fristen] Beenden fehlgeschlagen: call_geld Error: db weg",
    "[fristen] Beenden nach 3 Versuchen nicht gelungen: call_geld",
  ]);
});

test("Geld-Lauf: bleibt der Anruf nach dem Beenden aktiv, ohne dass es wirft, zaehlt er als offen", async () => {
  const { betrieb, lauf } = makeBetrieb({ gesperrt: true });
  betrieb.beendenLaesstAktiv = true;
  assert.deepEqual(await lauf().geldTakt(), { beendet: 0, offen: 1, gelesen: true });
});

test("Geld-Lauf: scheitert das Eintragen der naechsten Pruefung, steht der Fehler im Log und der Anruf zaehlt als offen", async (t) => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.setzenScheitert = true;
  let ergebnis;
  const zeilen = await mitFehlerzeilen(t, async () => {
    ergebnis = await lauf().geldTakt();
  });
  assert.deepEqual(ergebnis, { beendet: 0, offen: 1, gelesen: true });
  assert.deepEqual(zeilen, ["[fristen] Beenden fehlgeschlagen: call_geld Error: schreiben verweigert"]);
});

function taktAufbau({ geld, lesen }) {
  const arten = [];
  const store = {
    faelligeFristen: async ({ art }) => {
      arten.push(art);
      return lesen(art);
    },
    getCall: () => null,
    attachActiveCall: async () => null,
    setzeGeldFrist: async () => {},
  };
  const uhr = { aufgaben: [], setzeTakt: (aufgabe) => (uhr.aufgaben.push(aufgabe), { unref() {} }), loescheTakt() {} };
  starteFristenTakt({ store, beende: async () => {}, limitJeMandant: LIMIT, leaseMs: TAKT_MS, taktMs: TAKT_MS, uhr, geld });
  const tick = async () => {
    uhr.aufgaben[0]();
    await new Promise((erfuellen) => setImmediate(erfuellen));
  };
  return { arten, tick };
}

test("Geld-Takt: mit Geld-Verdrahtung liest jeder Takt erst die Hoechstdauer und dann das Geld", async () => {
  const { geld } = makeBetrieb();
  const { arten, tick } = taktAufbau({ geld, lesen: () => [] });
  await tick();
  assert.deepEqual(arten, ["hoechstdauer", "geld"]);
});

test("Geld-Takt: bricht die Hoechstdauer-Runde ab, wird das Geld trotzdem geprueft", async (t) => {
  const { geld } = makeBetrieb();
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const { arten, tick } = taktAufbau({
    geld,
    lesen: (art) => (art === "geld" ? [] : { map: () => { throw new Error("kaputt"); } }),
  });
  await tick();
  assert.deepEqual(arten, ["hoechstdauer", "geld"]);
  assert.deepEqual(zeilen.filter((zeile) => zeile.startsWith("[fristen]")), ["[fristen] Takt abgebrochen: Error: kaputt"]);
});
