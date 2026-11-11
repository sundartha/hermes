import { monitorEventLoopDelay } from "node:perf_hooks";

import { NANOSEKUNDEN_JE_MS } from "./telemetrie.js";

const P99 = 99;
const EINHEIT_MS = "ms";
const NAMEN = Object.freeze({
  eventloopP99: "hermes.eventloop.delay.p99",
  eventloopMax: "hermes.eventloop.delay.max",
  poolOffen: "hermes.db.pool.open",
  poolWartend: "hermes.db.pool.waiting",
});

function fangeFehler(messpunkt, arbeit) {
  try {
    return arbeit();
  } catch (fehler) {
    console.warn(`[betriebsmessung] ${messpunkt} fehlgeschlagen: ${fehler?.message}`);
    return undefined;
  }
}

function eventloopMessung(meter) {
  const histogramm = monitorEventLoopDelay();
  histogramm.enable();
  const p99 = meter.createObservableGauge(NAMEN.eventloopP99, { unit: EINHEIT_MS });
  const hoechst = meter.createObservableGauge(NAMEN.eventloopMax, { unit: EINHEIT_MS });
  meter.addBatchObservableCallback(
    (ergebnis) =>
      fangeFehler("eventloop", () => {
        if (histogramm.count === 0) return;
        ergebnis.observe(p99, histogramm.percentile(P99) / NANOSEKUNDEN_JE_MS);
        ergebnis.observe(hoechst, histogramm.max / NANOSEKUNDEN_JE_MS);
        histogramm.reset();
      }),
    [p99, hoechst],
  );
  return () => histogramm.disable();
}

function poolMessung(meter, poolZustand) {
  if (poolZustand() === null) return;
  const offen = meter.createObservableGauge(NAMEN.poolOffen);
  const wartend = meter.createObservableGauge(NAMEN.poolWartend);
  meter.addBatchObservableCallback(
    (ergebnis) =>
      fangeFehler("pool", () => {
        const zustand = poolZustand();
        ergebnis.observe(offen, zustand.offen);
        ergebnis.observe(wartend, zustand.wartend);
      }),
    [offen, wartend],
  );
}

export function schalteScharf({ meter, poolZustand }) {
  const beende = fangeFehler("scharfschalten", () => {
    const beendeEventloop = eventloopMessung(meter);
    poolMessung(meter, poolZustand);
    return beendeEventloop;
  });
  return beende ?? (() => {});
}
