import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";

import { makeGracefulShutdown } from "../../src/boot.js";
import { startServer } from "../helpers.js";
import { echteDatenbank } from "./echtes-postgres.js";
import { gemeinsameUmgebung } from "./zwei-prozesse.js";

const GESAMTFRIST_MS = 2000;
const ZEITGRENZE_MS = 60_000;
const EXIT_BEI_GESAMTFRIST = 1;
const GESAMTFRIST_ZEILE = "[shutdown] Gesamtfrist abgelaufen - Exit 1";

test(
  "S4: haengender finaler Flush endet nach der Gesamtfrist mit Exit 1 und Logzeile",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const prozess = await startServer({
      env: gemeinsameUmgebung(db.adresse, { SHUTDOWN_DRAIN_TIMEOUT_MS: String(GESAMTFRIST_MS) }),
    });
    t.after(() => prozess.stop());
    const sperre = await db.verbinden();
    await sperre.query("BEGIN");
    await sperre.query("LOCK TABLE tenant IN SHARE MODE");
    t.after(() => sperre.query("ROLLBACK").catch(() => {}));

    const beginn = performance.now();
    const beendet = once(prozess.child, "exit");
    prozess.child.kill("SIGTERM");
    const [exitCode] = await beendet;
    const dauerMs = performance.now() - beginn;

    assert.ok(
      prozess.stdout.includes(GESAMTFRIST_ZEILE),
      `${GESAMTFRIST_ZEILE} fehlt in der Ausgabe:\n${prozess.stdout}`,
    );
    assert.equal(exitCode, EXIT_BEI_GESAMTFRIST, `${GESAMTFRIST_ZEILE}: Exit ${exitCode}`);
    assert.ok(dauerMs >= GESAMTFRIST_MS * 0.9, `Prozess endete schon nach ${dauerMs} ms`);
  },
);

test("S4: kehrt der Flush erst nach der abgelaufenen Gesamtfrist zurueck, bleibt es bei genau einem exit(1)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const exits = [];
  let meldeFlushGestartet;
  const flushGestartet = new Promise((fertig) => (meldeFlushGestartet = fertig));
  let beendeFlush;
  const haengenderFlush = new Promise((fertig) => (beendeFlush = fertig));
  const shutdown = makeGracefulShutdown({
    httpServer: { close: (cb) => cb(), closeIdleConnections() {} },
    store: {
      save: async () => {},
      drainFlushes: () => {
        meldeFlushGestartet();
        return haengenderFlush;
      },
    },
    config: { server: { shutdownDrainTimeoutMs: GESAMTFRIST_MS } },
    exit: (code) => exits.push(code),
    log: () => {},
    logError: () => {},
  });

  const beendet = shutdown("SIGTERM");
  await flushGestartet;
  t.mock.timers.tick(GESAMTFRIST_MS);
  assert.deepEqual(exits, [EXIT_BEI_GESAMTFRIST], "Gesamtfrist abgelaufen -> exit(1)");

  beendeFlush();
  await beendet;
  assert.deepEqual(exits, [EXIT_BEI_GESAMTFRIST], "spaet zurueckkehrender Flush loest kein zweites exit aus");
});
