import { test } from "node:test";
import assert from "node:assert/strict";
import { pruefeBetrieb } from "../../scripts/ausfallproben/proben/instanz-tod.mjs";

const SCHWELLE = { healthzMs: 2000, haltenMs: 10_000, messTaktMs: 500 };
const LEBT = { prozess: { exitCode: null, signalCode: null } };

function uhr() {
  let jetzt = 0;
  return {
    jetzt: () => jetzt,
    pause: async (ms) => void (jetzt += ms),
    vor: (ms) => void (jetzt += ms),
  };
}

function messeMit(u, antwort) {
  return async () => {
    const beginn = u.jetzt();
    const { status, ms } = antwort(beginn);
    u.vor(ms);
    return { status, ms };
  };
}

const FAELLE = [
  ["dauerhaft 200 und schnell: gut", () => ({ status: 200, ms: 100 }), null, 100],
  ["200 genau an der Schwelle: gut", () => ({ status: 200, ms: 2000 }), null, 2000],
  [
    "200 eine Millisekunde ueber der Schwelle: rot",
    () => ({ status: 200, ms: 2001 }),
    "/healthz antwortete zu langsam",
    2001,
  ],
  ["503 sofort: rot", () => ({ status: 503, ms: 10 }), "/healthz antwortete nicht mit 200", 10],
  [
    "ohne Antwort: rot",
    () => ({ status: null, ms: 5000 }),
    "/healthz antwortete nicht mit 200",
    5000,
  ],
  [
    "nach 9 s kippt es auf 503: rot",
    (ab) => ({ status: ab >= 9000 ? 503 : 200, ms: 10 }),
    "/healthz antwortete nicht mit 200",
    10,
  ],
];

for (const [name, antwort, grund, laengste] of FAELLE) {
  test(`instanz-tod: ${name}`, async () => {
    const u = uhr();
    const ergebnis = await pruefeBetrieb(LEBT, "x", {
      schwelle: SCHWELLE,
      messe: messeMit(u, antwort),
      jetzt: u.jetzt,
      pause: u.pause,
    });
    assert.equal(ergebnis.grund, grund);
    assert.equal(ergebnis.laengste, laengste);
  });
}

test("instanz-tod: die Messung laeuft die ganzen 10 s im Takt von 500 ms", async () => {
  const u = uhr();
  const ergebnis = await pruefeBetrieb(LEBT, "x", {
    schwelle: SCHWELLE,
    messe: messeMit(u, () => ({ status: 200, ms: 0 })),
    jetzt: u.jetzt,
    pause: u.pause,
  });
  assert.equal(ergebnis.messungen, 20);
});

test("instanz-tod: ein beendeter Prozess ist rot, auch wenn er durch ein Signal endete", async () => {
  for (const prozess of [
    { exitCode: 1, signalCode: null },
    { exitCode: null, signalCode: "SIGKILL" },
  ]) {
    const ergebnis = await pruefeBetrieb({ prozess }, "x", {
      schwelle: SCHWELLE,
      messe: async () => ({ status: 200, ms: 1 }),
      jetzt: uhr().jetzt,
      pause: async () => {},
    });
    assert.equal(ergebnis.grund, "Hermes beendete sich");
    assert.equal(ergebnis.messungen, 0);
  }
});
