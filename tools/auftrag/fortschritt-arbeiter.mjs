import { workerData } from "node:worker_threads";

import { fuehreAus } from "./pruefungen.mjs";

const { port, argumente, gestartet } = workerData;
Atomics.store(gestartet, 0, 1);
try {
  port.postMessage({ ergebnis: fuehreAus(...argumente) });
} catch (fehler) {
  port.postMessage({ fehler: String(fehler?.stack ?? fehler) });
}
