import { test } from "node:test";
import assert from "node:assert/strict";
import { starteFristenTakt } from "../../src/telephony/fristen-lauf.ts";

const TAKT_MS = 15000;
const LIMIT = 7;
const LEASE_MS = 9000;

function aufbau({ lesen } = {}) {
  const geholt = [];
  const store = {
    faelligeFristen: async (anfrage) => {
      geholt.push(anfrage);
      return lesen ? lesen() : [];
    },
    getCall: () => null,
    attachActiveCall: async () => null,
  };
  const uhr = {
    gesetzt: [],
    geloescht: [],
    unrefs: 0,
    setzeTakt(aufgabe, ms) {
      const handle = { aufgabe, ms, unref: () => (uhr.unrefs += 1) };
      uhr.gesetzt.push(handle);
      return handle;
    },
    loescheTakt: (handle) => uhr.geloescht.push(handle),
  };
  const start = () =>
    starteFristenTakt({ store, beende: async () => {}, limitJeMandant: LIMIT, leaseMs: LEASE_MS, taktMs: TAKT_MS, uhr });
  const tick = async () => {
    uhr.gesetzt[0].aufgabe();
    await new Promise((erfuellen) => setImmediate(erfuellen));
  };
  return { geholt, start, uhr, tick };
}

test("Fristentakt: der Takt laeuft im eingestellten Abstand und liest je Takt einmal mit Limit und Lease", async () => {
  const { geholt, start, uhr, tick } = aufbau();
  start();
  assert.equal(uhr.gesetzt.length, 1);
  assert.equal(uhr.gesetzt[0].ms, TAKT_MS);
  assert.equal(geholt.length, 0);
  await tick();
  assert.deepEqual(geholt, [{ art: "hoechstdauer", limitJeMandant: LIMIT, leaseMs: LEASE_MS }]);
  await tick();
  assert.equal(geholt.length, 2);
});

test("Fristentakt: der Timer haelt den Prozess nicht am Leben und stoppen loescht genau diesen Timer", () => {
  const { start, uhr } = aufbau();
  const takt = start();
  assert.equal(uhr.unrefs, 1);
  assert.deepEqual(uhr.geloescht, []);
  takt.stoppen();
  assert.deepEqual(uhr.geloescht, [uhr.gesetzt[0]]);
});

test("Fristentakt: ein Takt, der noch laeuft, wird nicht ein zweites Mal gestartet", async () => {
  let freigeben;
  const haelt = new Promise((erfuellen) => {
    freigeben = erfuellen;
  });
  const { geholt, start, tick } = aufbau({ lesen: () => haelt });
  start();
  await tick();
  await tick();
  assert.equal(geholt.length, 1);
  freigeben([]);
  await new Promise((erfuellen) => setImmediate(erfuellen));
  await tick();
  assert.equal(geholt.length, 2);
});

test("Fristentakt: scheitert das Lesen, steht der Fehler im Log und der naechste Takt liest wieder", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const { geholt, start, tick } = aufbau({
    lesen: () => {
      throw new Error("db nicht erreichbar");
    },
  });
  start();
  await tick();
  await tick();
  assert.equal(geholt.length, 2);
  assert.deepEqual(
    zeilen.filter((zeile) => zeile.startsWith("[fristen]")),
    [
      "[fristen] Takt: faellige Fristen lesen fehlgeschlagen: db nicht erreichbar",
      "[fristen] Takt: faellige Fristen lesen fehlgeschlagen: db nicht erreichbar",
    ],
  );
});

test("Fristentakt: bricht ein Takt unerwartet ab, steht das im Log und der naechste Takt laeuft", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  let aufrufe = 0;
  const { geholt, start, tick } = aufbau({
    lesen: () => {
      aufrufe += 1;
      if (aufrufe > 1) return [];
      return {
        map: () => {
          throw new Error("kaputt");
        },
      };
    },
  });
  start();
  await tick();
  await tick();
  assert.equal(geholt.length, 2);
  assert.deepEqual(
    zeilen.filter((zeile) => zeile.startsWith("[fristen]")),
    ["[fristen] Takt abgebrochen: Error: kaputt"],
  );
});
