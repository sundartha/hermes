import assert from "node:assert/strict";
import test from "node:test";
import { makeGracefulShutdown } from "../../src/boot.js";

function fakeHttpServer() {
  return { close: (cb) => cb(), closeIdleConnections() {} };
}
const FAKE_CONFIG = { server: { shutdownDrainTimeoutMs: 10000 } };

test("S1-2: gracefulShutdown -> rejectender finaler Flush = genau ein exit(1) + lauter Alarm", async () => {
  const exits = [];
  const errors = [];
  const shutdown = makeGracefulShutdown({
    httpServer: fakeHttpServer(),
    store: {
      save: async () => {},
      drainFlushes: async () => {
        throw new Error("DB weg (Test)");
      },
    },
    config: FAKE_CONFIG,
    exit: (c) => exits.push(c),
    log: () => {},
    logError: (m) => errors.push(m),
  });
  await shutdown("SIGTERM");
  assert.deepEqual(exits, [1], "fehlgeschlagener finaler Flush -> genau ein exit(1), kein Fall-through");
  assert.ok(errors.some((m) => /FEHLGESCHLAGEN/.test(m)), "lauter Datenverlust-Alarm");
});

test("S1-2: gracefulShutdown -> erfolgreicher finaler Flush = genau ein exit(0)", async () => {
  const exits = [];
  const shutdown = makeGracefulShutdown({
    httpServer: fakeHttpServer(),
    store: { save: async () => {}, drainFlushes: async () => {} },
    config: FAKE_CONFIG,
    exit: (c) => exits.push(c),
    log: () => {},
    logError: () => {},
  });
  await shutdown("SIGTERM");
  assert.deepEqual(exits, [0], "sauberer Flush -> genau ein exit(0)");
});

const TEILFRIST_VON_FAKE_CONFIG_MS = 8000;

function stoppMitEinerAnfrage(antwort) {
  let meldeAnfrage;
  const schritte = [];
  const beendet = [];
  const stoppen = makeGracefulShutdown({
    httpServer: {
      on: (_ereignis, behandeln) => (meldeAnfrage = behandeln),
      close: () => schritte.push("close"),
      closeIdleConnections: () => {},
      closeAllConnections: () => schritte.push("closeAll"),
    },
    store: { save: async () => {}, drainFlushes: async () => {} },
    config: FAKE_CONFIG,
    exit: (code) => beendet.push(code),
    log: () => {},
    logError: () => {},
  });
  meldeAnfrage({}, antwort);
  return { stoppen, schritte, beendet };
}

test("eine beim Zaehlen schon beendete Antwort laesst den Stopp nicht auf die Teilfrist warten", async () => {
  const { stoppen, schritte, beendet } = stoppMitEinerAnfrage({ writableEnded: true, once: () => {} });
  await stoppen("SIGTERM");
  assert.deepEqual(schritte, ["close"]);
  assert.deepEqual(beendet, [0]);
});

test("laeuft die Teilfrist ab, bricht der Stopp offene Verbindungen nach dem Schliessen der Annahme ab", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { stoppen, schritte, beendet } = stoppMitEinerAnfrage({ writableEnded: false, once: () => {} });
  const fertig = stoppen("SIGTERM");
  t.mock.timers.tick(TEILFRIST_VON_FAKE_CONFIG_MS);
  await fertig;
  assert.deepEqual(schritte, ["close", "closeAll"]);
  assert.deepEqual(beendet, [0]);
});
