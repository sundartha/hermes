import { test } from "node:test";
import assert from "node:assert/strict";
import { pruefeBetrieb } from "../../scripts/ausfallproben/proben/instanz-tod.mjs";

const SCHWELLE = { healthzMs: 2000, haltenMs: 10_000, messTaktMs: 500 };
const LEBT = { prozess: { exitCode: null, signalCode: null } };
const NORMAL = { status: 200, ms: 100 };

function lauf(antwort) {
  let jetzt = 0;
  let aufruf = 0;
  const messe = async () => {
    const { status, ms } = antwort(jetzt, aufruf++);
    jetzt += ms;
    return { status, ms };
  };
  return pruefeBetrieb(LEBT, "x", {
    schwelle: SCHWELLE,
    messe,
    jetzt: () => jetzt,
    pause: async (ms) => void (jetzt += ms),
  });
}

test("instanz-tod: ein einzelner Ausreisser durch Runner-Last bleibt gruen", async () => {
  const ergebnis = await lauf((ab, nr) => (nr === 3 ? { status: 200, ms: 4500 } : NORMAL));
  assert.equal(ergebnis.grund, null);
  assert.equal(ergebnis.laengste, 100);
});

test("instanz-tod: ein Ausreisser mit anschliessend langsamer Wiederholung ist rot", async () => {
  const ergebnis = await lauf((ab, nr) => (nr >= 3 ? { status: 200, ms: 2001 } : NORMAL));
  assert.equal(ergebnis.grund, "/healthz antwortete zu langsam");
  assert.equal(ergebnis.laengste, 2001);
});

test("instanz-tod: ein Ausreisser mit anschliessendem 503 ist rot", async () => {
  const ergebnis = await lauf((ab, nr) => {
    if (nr === 3) return { status: 200, ms: 4500 };
    return nr === 4 ? { status: 503, ms: 5 } : NORMAL;
  });
  assert.equal(ergebnis.grund, "/healthz antwortete nicht mit 200");
});

test("instanz-tod: Verzug der Instanz ab 3 s ist rot", async () => {
  const ergebnis = await lauf((ab) => (ab >= 3000 ? { status: 200, ms: 2500 } : NORMAL));
  assert.equal(ergebnis.grund, "/healthz antwortete zu langsam");
});

test("instanz-tod: ohne Antwort ab 3 s ist rot", async () => {
  const ergebnis = await lauf((ab) => (ab >= 3000 ? { status: null, ms: 5000 } : NORMAL));
  assert.equal(ergebnis.grund, "/healthz antwortete nicht mit 200");
});

test("instanz-tod: die Wiederholung zaehlt als Messung", async () => {
  const ergebnis = await lauf((ab, nr) => (nr === 0 ? { status: 200, ms: 4500 } : NORMAL));
  assert.equal(ergebnis.messungen, 11);
});

test("instanz-tod: genau an der Schwelle wird nicht wiederholt", async () => {
  const ergebnis = await lauf(() => ({ status: 200, ms: 2000 }));
  assert.equal(ergebnis.grund, null);
  assert.equal(ergebnis.messungen, 4);
});

test("instanz-tod: eine fehlende Antwort wird nicht wiederholt", async () => {
  const ergebnis = await lauf(() => ({ status: null, ms: 5000 }));
  assert.equal(ergebnis.messungen, 1);
});

test("instanz-tod: ein langsames 503 wird nicht wiederholt", async () => {
  const ergebnis = await lauf(() => ({ status: 503, ms: 3000 }));
  assert.equal(ergebnis.messungen, 1);
});
