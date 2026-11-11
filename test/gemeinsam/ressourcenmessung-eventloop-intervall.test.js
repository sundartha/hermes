import { test } from "node:test";
import assert from "node:assert/strict";

import { starteTelemetrie } from "../../src/utils/telemetrie.js";
import { startEmpfaenger, warteAufExport, wert } from "./otlp-empfaenger.js";

const TOKEN = "t".repeat(20);
const EXPORT_INTERVALL_MS = 50;
const MAX_EVENTLOOP_MS = 1000;
const BLOCKADE_MS = 1300;
const MAX_NAME = "hermes.eventloop.delay.max";

const maxVon = (messwerte) => messwerte[MAX_NAME] && wert(messwerte[MAX_NAME].punkte);

test("Ressourcenmessung S17: der Hoechstwert gilt je Exportintervall und faellt nach einer Blockade wieder", async () => {
  const empfaenger = await startEmpfaenger();
  const telemetrie = await starteTelemetrie({
    url: empfaenger.url,
    token: TOKEN,
    intervallMs: EXPORT_INTERVALL_MS,
  });
  try {
    await warteAufExport(empfaenger, maxVon);
    const ende = performance.now() + BLOCKADE_MS;
    while (performance.now() < ende);
    const hoch = await warteAufExport(empfaenger, (m) => maxVon(m) > MAX_EVENTLOOP_MS);
    assert.ok(maxVon(hoch) > MAX_EVENTLOOP_MS);
    const danach = empfaenger.exporte.length;
    const niedrig = await warteAufExport(empfaenger, (m) => maxVon(m) <= MAX_EVENTLOOP_MS, danach);
    assert.ok(maxVon(niedrig) <= MAX_EVENTLOOP_MS);
  } finally {
    await telemetrie.stoppe();
    await empfaenger.stop();
  }
});
