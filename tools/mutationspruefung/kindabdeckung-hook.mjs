import { randomUUID } from "node:crypto";
import { join } from "node:path";
import process, { env, pid } from "node:process";

import { ablage } from "./kindabdeckung-ablage.mjs";
import { KINDABDECKUNG_ORDNER, KINDABDECKUNG_TESTDATEI } from "./zustand.mjs";

const NAMENSRAUM = "__stryker__";
const TAKT_MS = 100;
const BEENDENDE_SIGNALE = ["SIGTERM", "SIGINT", "SIGHUP"];

const ablegen = ablage({
  datei: join(env[KINDABDECKUNG_ORDNER], `${randomUUID()}.json`),
  testdatei: env[KINDABDECKUNG_TESTDATEI],
  abdeckung: () => globalThis[NAMENSRAUM]?.mutantCoverage,
});

function beimSignal(signal) {
  ablegen();
  if (process.listenerCount(signal) > 1) return;
  process.removeListener(signal, beimSignal);
  process.kill(pid, signal);
}

setInterval(ablegen, TAKT_MS).unref();
process.on("exit", ablegen);
for (const signal of BEENDENDE_SIGNALE) process.on(signal, beimSignal);
