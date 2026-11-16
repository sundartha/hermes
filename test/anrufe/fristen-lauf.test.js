import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFristenLauf } from "../../src/telephony/fristen-lauf.ts";

const TAKT_MS = 15000;
const LIMIT = 5;
const MAX_VERSUCHE = 3;
const ANRUF = "call_fl";

function makeBetrieb() {
  const betrieb = {
    status: "active",
    faelligAb: 0,
    uhr: 0,
    leaseBis: 0,
    versuche: 0,
    geholt: [],
    beendet: [],
    beendenScheitert: false,
    lesenScheitert: false,
    attachListe: [],
  };
  const spiegel = new Map();
  const store = {
    faelligeFristen: async (anfrage) => {
      betrieb.geholt.push(anfrage);
      if (betrieb.lesenScheitert) throw new Error("db nicht erreichbar");
      const faellig = betrieb.status === "active" && betrieb.uhr >= betrieb.faelligAb && betrieb.leaseBis <= betrieb.uhr;
      if (!faellig) return [];
      betrieb.leaseBis = betrieb.uhr + anfrage.leaseMs;
      betrieb.versuche += 1;
      return [{ callId: ANRUF, tenantId: "tenant_fl", faelligAt: "x", versuche: betrieb.versuche }];
    },
    attachActiveCall: async (id) => {
      betrieb.attachListe.push(id);
      if (betrieb.status !== "active") return null;
      if (!spiegel.has(id)) spiegel.set(id, { id, status: "active", twilioSid: "CA_fl" });
      return spiegel.get(id);
    },
    getCall: (id) => spiegel.get(id) ?? null,
  };
  const beende = async (call) => {
    if (betrieb.beendenScheitert) throw new Error("db weg");
    betrieb.beendet.push(call.id);
    betrieb.status = "failed";
    spiegel.get(call.id).status = "failed";
  };
  const lauf = () => makeFristenLauf({ store, beende, limitJeMandant: LIMIT, leaseMs: TAKT_MS });
  return { betrieb, store, lauf, spiegel };
}

async function mitFehlerzeilen(t, body) {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  await body();
  return zeilen.filter((zeile) => zeile.startsWith("[fristen]"));
}

test("Fristenlauf: ein faelliger Anruf wird uebernommen und beendet, vorher und danach ist nichts zu tun", async () => {
  const { betrieb, lauf } = makeBetrieb();
  const eins = lauf();
  betrieb.faelligAb = 1;
  assert.deepEqual(await eins.takt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.beendet, []);
  betrieb.uhr = 1;
  assert.deepEqual(await eins.takt(), { beendet: 1, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.beendet, [ANRUF]);
  assert.deepEqual(await eins.takt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.geholt[0], { art: "hoechstdauer", limitJeMandant: LIMIT, leaseMs: TAKT_MS });
});

test("Fristenlauf: zwei Prozesse holen dieselbe faellige Zeile gleichzeitig, genau einer beendet sie", async () => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.uhr = 1;
  const ergebnisse = await Promise.all([lauf().takt(), lauf().takt()]);
  assert.deepEqual(ergebnisse.map((ergebnis) => ergebnis.beendet).sort(), [0, 1]);
  assert.deepEqual(betrieb.beendet, [ANRUF]);
});

test("Fristenlauf: war die Zeile in der Datenbank schon beendet, wird nichts beendet", async () => {
  const { betrieb, store } = makeBetrieb();
  const faellig = [{ callId: ANRUF, tenantId: "tenant_fl", faelligAt: "x", versuche: 1 }];
  betrieb.status = "completed";
  const lauf = makeFristenLauf({
    store: { ...store, faelligeFristen: async () => faellig },
    beende: async (call) => betrieb.beendet.push(call.id),
    limitJeMandant: LIMIT,
    leaseMs: TAKT_MS,
  });
  assert.deepEqual(await lauf.takt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.beendet, []);
});

test("Fristenlauf: liefert die Uebernahme einen nicht mehr aktiven Anruf, wird er nicht beendet", async () => {
  const { betrieb, store } = makeBetrieb();
  const lauf = makeFristenLauf({
    store: {
      ...store,
      faelligeFristen: async () => [{ callId: ANRUF, tenantId: "tenant_fl", faelligAt: "x", versuche: 1 }],
      attachActiveCall: async () => ({ id: ANRUF, status: "completed" }),
    },
    beende: async (call) => betrieb.beendet.push(call.id),
    limitJeMandant: LIMIT,
    leaseMs: TAKT_MS,
  });
  assert.deepEqual(await lauf.takt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.beendet, []);
});

test("Fristenlauf: scheitert das Beenden, versucht es der naechste Takt erneut, ab dem dritten Versuch steht der Fehler mit Anruf-ID im Log", async (t) => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.beendenScheitert = true;
  const eins = lauf();
  const proTakt = [];
  const zeilen = await mitFehlerzeilen(t, async () => {
    for (let versuch = 1; versuch <= MAX_VERSUCHE; versuch++) {
      betrieb.uhr = versuch * TAKT_MS;
      assert.deepEqual(await eins.takt(), { beendet: 0, offen: 1, gelesen: true });
      const fehlerLog = console.error.mock;
      const aufrufe = fehlerLog.calls.map((aufruf) => String(aufruf.arguments[0]));
      proTakt.push(aufrufe.filter((text) => text.includes("nicht gelungen")).length);
    }
  });
  assert.deepEqual(proTakt, [0, 0, 1]);
  assert.deepEqual(zeilen, [
    "[fristen] Beenden fehlgeschlagen: call_fl Error: db weg",
    "[fristen] Beenden fehlgeschlagen: call_fl Error: db weg",
    "[fristen] Beenden fehlgeschlagen: call_fl Error: db weg",
    "[fristen] Beenden nach 3 Versuchen nicht gelungen: call_fl",
  ]);
  betrieb.beendenScheitert = false;
  betrieb.uhr += TAKT_MS;
  assert.deepEqual(await eins.takt(), { beendet: 1, offen: 0, gelesen: true });
  assert.deepEqual(betrieb.beendet, [ANRUF]);
});

test("Fristenlauf: bleibt der Anruf nach dem Beenden aktiv, ohne dass es wirft, zaehlt er als offen", async (t) => {
  const { betrieb, store } = makeBetrieb();
  const lauf = makeFristenLauf({
    store,
    beende: async () => undefined,
    limitJeMandant: LIMIT,
    leaseMs: TAKT_MS,
  });
  betrieb.uhr = 1;
  let ergebnis;
  const zeilen = await mitFehlerzeilen(t, async () => {
    ergebnis = await lauf.takt();
  });
  assert.deepEqual(ergebnis, { beendet: 0, offen: 1, gelesen: true });
  assert.deepEqual(zeilen, []);
});

test("Fristenlauf: ein Lesefehler steht im Log, der Takt meldet ihn und beendet nichts", async (t) => {
  const { betrieb, lauf } = makeBetrieb();
  betrieb.uhr = 1;
  betrieb.lesenScheitert = true;
  let ergebnis;
  const zeilen = await mitFehlerzeilen(t, async () => {
    ergebnis = await lauf().takt();
  });
  assert.deepEqual(ergebnis, { beendet: 0, offen: 0, gelesen: false });
  assert.deepEqual(zeilen, ["[fristen] Takt: faellige Fristen lesen fehlgeschlagen: db nicht erreichbar"]);
  assert.deepEqual(betrieb.beendet, []);
});

test("Fristenlauf: fehlt der Anruf nach dem Beenden im Spiegel, zaehlt er als beendet", async () => {
  const { betrieb, store, spiegel } = makeBetrieb();
  const lauf = makeFristenLauf({
    store,
    beende: async (call) => {
      betrieb.status = "failed";
      spiegel.delete(call.id);
    },
    limitJeMandant: LIMIT,
    leaseMs: TAKT_MS,
  });
  betrieb.uhr = 1;
  assert.deepEqual(await lauf.takt(), { beendet: 1, offen: 0, gelesen: true });
});
