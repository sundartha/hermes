import assert from "node:assert/strict";
import { test } from "node:test";
import { makeFristenLauf, starteFristenTakt } from "../../src/telephony/fristen-lauf.ts";

const TAKT_MS = 15000;
const LIMIT = 5;
const ANRUF = "call_abfrage";
const MANDANT = "tenant_abfrage";

function makeBetrieb() {
  const betrieb = { geholt: [], abgefragt: [], lesenScheitert: false, pollScheitert: false, versuche: 1 };
  const store = {
    faelligeFristen: async (anfrage) => {
      betrieb.geholt.push(anfrage);
      if (betrieb.lesenScheitert) throw new Error("db nicht erreichbar");
      return anfrage.art === "abfrage" ? [{ callId: ANRUF, tenantId: MANDANT, faelligAt: "x", versuche: betrieb.versuche }] : [];
    },
    attachActiveCall: async () => null,
    getCall: () => null,
  };
  const abfrage = {
    poll: async (callId, tenantId) => {
      if (betrieb.pollScheitert) throw new Error("abfrage verweigert");
      betrieb.abgefragt.push([callId, tenantId]);
    },
  };
  const lauf = (zusatz = {}) =>
    makeFristenLauf({ store, beende: async () => {}, limitJeMandant: LIMIT, leaseMs: TAKT_MS, abfrage, ...zusatz });
  return { betrieb, store, abfrage, lauf };
}

async function mitFehlerzeilen(t, body) {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  await body();
  return zeilen.filter((zeile) => zeile.startsWith("[fristen]"));
}

test("Abfrage-Lauf: eine faellige Abfrage ruft die Abfrage mit Anruf und Mandant der Zeile auf", async () => {
  const { betrieb, lauf } = makeBetrieb();
  assert.deepEqual(await lauf().abfrageTakt(), { beendet: 1, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.geholt, [{ art: "abfrage", limitJeMandant: LIMIT, leaseMs: TAKT_MS }]);
  assert.deepEqual(betrieb.abgefragt, [[ANRUF, MANDANT]]);
});

test("Abfrage-Lauf: scheitert die Abfrage, steht Anruf und Fehler im Log und die Zeile bleibt offen", async (t) => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.pollScheitert = true;
  const zeilen = await mitFehlerzeilen(t, async () => {
    assert.deepEqual(await lauf().abfrageTakt(), { beendet: 0, offen: 1, gelesen: true });
  });
  assert.deepEqual(zeilen, [`[fristen] Abfrage fehlgeschlagen: ${ANRUF} Error: abfrage verweigert`]);
});

test("Abfrage-Lauf: ab dem dritten Fehlversuch steht ein Fehler mit der Anruf-Kennung im Log", async (t) => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.pollScheitert = true;
  betrieb.versuche = 3;
  const zeilen = await mitFehlerzeilen(t, async () => {
    await lauf().abfrageTakt();
  });
  assert.ok(zeilen.includes(`[fristen] Beenden nach 3 Versuchen nicht gelungen: ${ANRUF}`));
});

test("Abfrage-Lauf: ohne Abfrage-Abhaengigkeit liest der Takt nichts und meldet nichts offen", async () => {
  const { betrieb, lauf } = makeBetrieb();
  assert.deepEqual(await lauf({ abfrage: undefined }).abfrageTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.geholt, []);
});

test("Abfrage-Lauf: schlaegt das Lesen fehl, steht der Fehler im Log und es wird nichts abgefragt", async (t) => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.lesenScheitert = true;
  const zeilen = await mitFehlerzeilen(t, async () => {
    assert.deepEqual(await lauf().abfrageTakt(), { beendet: 0, offen: 0, gelesen: false });
  });
  assert.deepEqual(zeilen, ["[fristen] Takt: faellige Fristen lesen fehlgeschlagen: db nicht erreichbar"]);
  assert.deepEqual(betrieb.abgefragt, []);
});

test("Fristentakt: ein Takt liest nacheinander Hoechstdauer, Geld, Reserve und Abfrage", async () => {
  const { betrieb, store, abfrage } = makeBetrieb();
  const uhr = {
    aufgabe: null,
    setzeTakt(aufgabe) {
      uhr.aufgabe = aufgabe;
      return { unref: () => {} };
    },
    loescheTakt: () => {},
  };
  const geld = { intervalMs: 1, jetzt: Date.now, blockingAxisFor: () => null, beende: async () => {} };
  starteFristenTakt({
    store,
    beende: async () => {},
    geld,
    reserve: { freigeben: async () => {} },
    abfrage,
    limitJeMandant: LIMIT,
    leaseMs: TAKT_MS,
    taktMs: TAKT_MS,
    uhr,
  });
  uhr.aufgabe();
  await new Promise((erfuellen) => setImmediate(erfuellen));
  assert.deepEqual(
    betrieb.geholt.map((anfrage) => anfrage.art),
    ["hoechstdauer", "geld", "reserve", "abfrage"],
  );
  assert.deepEqual(betrieb.abgefragt, [[ANRUF, MANDANT]]);
});
