import assert from "node:assert/strict";
import { test } from "node:test";
import { makeFristenLauf } from "../../src/telephony/fristen-lauf.ts";

const TAKT_MS = 15000;
const LIMIT = 5;
const ANRUF = "call_reserve";
const MANDANT = "tenant_reserve";

function makeBetrieb({ imSpiegel = true } = {}) {
  const betrieb = {
    geholt: [],
    freigegeben: [],
    geleert: [],
    lesenScheitert: false,
    freigebenScheitert: false,
    leerenScheitert: false,
    keinTreffer: false,
  };
  const call = { id: ANRUF, tenantId: MANDANT, status: "completed", twilioSid: "CA_reserve", reserveCents: 40 };
  const store = {
    faelligeFristen: async (anfrage) => {
      betrieb.geholt.push(anfrage);
      if (betrieb.lesenScheitert) throw new Error("db nicht erreichbar");
      if (betrieb.keinTreffer) return [];
      return [{ callId: ANRUF, tenantId: MANDANT, faelligAt: "x", versuche: betrieb.geholt.length }];
    },
    attachActiveCall: async () => null,
    getCall: () => (imSpiegel ? call : null),
    setzeGeldFrist: async () => {},
    setzeReserveFrist: async (frist) => {
      if (betrieb.leerenScheitert) throw new Error("schreiben verweigert");
      betrieb.geleert.push(frist);
    },
  };
  const reserve = {
    freigeben: async (angefragt) => {
      if (betrieb.freigebenScheitert) throw new Error("freigeben verweigert");
      betrieb.freigegeben.push(angefragt);
    },
  };
  const lauf = (zusatz = {}) =>
    makeFristenLauf({ store, beende: async () => {}, limitJeMandant: LIMIT, leaseMs: TAKT_MS, reserve, ...zusatz });
  return { betrieb, call, lauf };
}

async function mitFehlerzeilen(t, body) {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  await body();
  return zeilen.filter((zeile) => zeile.startsWith("[fristen]"));
}

test("Reserve-Lauf: eine faellige Reserve wird mit dem Anruf aus dem Spiegel freigegeben und die Frist an der Zeile geleert", async () => {
  const { betrieb, call, lauf } = makeBetrieb();
  assert.deepEqual(await lauf().reserveTakt(), { beendet: 1, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.geholt, [{ art: "reserve", limitJeMandant: LIMIT, leaseMs: TAKT_MS }]);
  assert.deepEqual(betrieb.freigegeben, [call]);
  assert.deepEqual(betrieb.geleert, [{ callId: ANRUF, tenantId: MANDANT, faelligAt: null }]);
});

test("Reserve-Lauf: kennt dieser Prozess den Anruf nicht (Neustart), wird die Reserve ueber Anruf und Mandant der Zeile freigegeben", async () => {
  const { betrieb, lauf } = makeBetrieb({ imSpiegel: false });
  assert.deepEqual(await lauf().reserveTakt(), { beendet: 1, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.freigegeben, [{ id: ANRUF, tenantId: MANDANT }]);
  assert.deepEqual(betrieb.geleert, [{ callId: ANRUF, tenantId: MANDANT, faelligAt: null }]);
});

test("Reserve-Lauf: die Hoechstdauer- und die Geld-Runde lesen keine Reserve-Fristen", async () => {
  const { betrieb, lauf } = makeBetrieb();
  await lauf().takt();
  await lauf().geldTakt();
  assert.deepEqual(betrieb.geholt.map((anfrage) => anfrage.art), ["hoechstdauer"]);
  assert.deepEqual(betrieb.freigegeben, []);
});

test("Reserve-Lauf: ohne Reserve-Verdrahtung liest der Takt keine Reserve-Fristen", async () => {
  const { betrieb, lauf } = makeBetrieb();
  assert.deepEqual(await lauf({ reserve: undefined }).reserveTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.geholt, []);
});

test("Reserve-Lauf: ohne faellige Zeile passiert nichts", async () => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.keinTreffer = true;
  assert.deepEqual(await lauf().reserveTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.freigegeben, []);
  assert.deepEqual(betrieb.geleert, []);
});

test("Reserve-Lauf: ein Lesefehler steht im Log, der Takt meldet ihn und gibt nichts frei", async (t) => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.lesenScheitert = true;
  let ergebnis;
  const zeilen = await mitFehlerzeilen(t, async () => {
    ergebnis = await lauf().reserveTakt();
  });
  assert.deepEqual(ergebnis, { beendet: 0, offen: 0, gelesen: false });
  assert.deepEqual(zeilen, ["[fristen] Takt: faellige Fristen lesen fehlgeschlagen: db nicht erreichbar"]);
  assert.deepEqual(betrieb.freigegeben, []);
});

test("Reserve-Lauf: scheitert die Freigabe, bleibt die Frist stehen, der Fehler steht mit Anruf-ID im Log und ab dem dritten Versuch die Meldung", async (t) => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.freigebenScheitert = true;
  const eins = lauf();
  const zeilen = await mitFehlerzeilen(t, async () => {
    for (let versuch = 1; versuch <= 3; versuch++) assert.deepEqual(await eins.reserveTakt(), { beendet: 0, offen: 1, gelesen: true });
  });
  assert.deepEqual(zeilen, [
    "[fristen] Reserve freigeben fehlgeschlagen: call_reserve Error: freigeben verweigert",
    "[fristen] Reserve freigeben fehlgeschlagen: call_reserve Error: freigeben verweigert",
    "[fristen] Reserve freigeben fehlgeschlagen: call_reserve Error: freigeben verweigert",
    "[fristen] Beenden nach 3 Versuchen nicht gelungen: call_reserve",
  ]);
  assert.deepEqual(betrieb.geleert, []);
});

test("Reserve-Lauf: scheitert das Leeren der Frist, zaehlt der Anruf als offen und die naechste Runde gibt die Reserve noch einmal frei", async (t) => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.leerenScheitert = true;
  const eins = lauf();
  const zeilen = await mitFehlerzeilen(t, async () => {
    assert.deepEqual(await eins.reserveTakt(), { beendet: 0, offen: 1, gelesen: true });
  });
  assert.deepEqual(zeilen, ["[fristen] Reserve freigeben fehlgeschlagen: call_reserve Error: schreiben verweigert"]);
  betrieb.leerenScheitert = false;
  assert.deepEqual(await eins.reserveTakt(), { beendet: 1, offen: 0, gelesen: true });
  assert.equal(betrieb.freigegeben.length, 2);
});
