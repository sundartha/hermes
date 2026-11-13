import { monitorEventLoopDelay } from "node:perf_hooks";

export const NANOSEKUNDEN_JE_MS = 1_000_000;
const P99 = 99;
const EINHEIT_MS = "ms";
const NAMEN = Object.freeze({
  eventloopP99: "hermes.eventloop.delay.p99",
  eventloopMax: "hermes.eventloop.delay.max",
  poolOffen: "hermes.db.pool.open",
  poolWartend: "hermes.db.pool.waiting",
  warteschlangeLaenge: "hermes.queue.length",
  warteschlangeAlter: "hermes.queue.oldest_age",
  leitungenBelegt: "hermes.lines.occupied",
  leitungenKapazitaet: "hermes.lines.capacity",
  anrufGestartet: "hermes.call.started",
  anrufAbgelehnt: "hermes.call.denied",
});

let anrufZaehler = null;

function fangeFehler(messpunkt, arbeit) {
  try {
    return arbeit();
  } catch (fehler) {
    console.warn(`[betriebsmessung] ${messpunkt} fehlgeschlagen: ${fehler?.message}`);
    return undefined;
  }
}

async function fangeFehlerAsync(messpunkt, arbeit) {
  try {
    await arbeit();
  } catch (fehler) {
    console.warn(`[betriebsmessung] ${messpunkt} fehlgeschlagen: ${fehler?.message}`);
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

function warteschlangeMessung(meter, warteschlangeZustand) {
  const laenge = meter.createObservableGauge(NAMEN.warteschlangeLaenge);
  const alter = meter.createObservableGauge(NAMEN.warteschlangeAlter, { unit: "s" });
  meter.addBatchObservableCallback(
    (ergebnis) =>
      fangeFehlerAsync("warteschlange", async () => {
        for (const zustand of (await warteschlangeZustand()) ?? []) {
          ergebnis.observe(laenge, zustand.laenge, { art: zustand.art });
          ergebnis.observe(alter, zustand.aeltesteSekunden, { art: zustand.art });
        }
      }),
    [laenge, alter],
  );
}

function leitungenMessung(meter, leitungsplaetzeBelegung) {
  if (!leitungsplaetzeBelegung) return;
  const belegt = meter.createObservableGauge(NAMEN.leitungenBelegt);
  const kapazitaet = meter.createObservableGauge(NAMEN.leitungenKapazitaet);
  meter.addBatchObservableCallback(
    (ergebnis) =>
      fangeFehlerAsync("leitungen", async () => {
        for (const zeile of await leitungsplaetzeBelegung()) {
          ergebnis.observe(belegt, zeile.belegt, { anbieter: zeile.anbieter });
          ergebnis.observe(kapazitaet, zeile.kapazitaet, { anbieter: zeile.anbieter });
        }
      }),
    [belegt, kapazitaet],
  );
}

function anrufMessung(meter) {
  anrufZaehler = {
    gestartet: meter.createCounter(NAMEN.anrufGestartet),
    abgelehnt: meter.createCounter(NAMEN.anrufAbgelehnt),
  };
  return () => {
    anrufZaehler = null;
  };
}

export function zaehleAnrufGestartet(richtung) {
  fangeFehler("anruf_gestartet", () => anrufZaehler?.gestartet.add(1, { direction: richtung }));
}

export function zaehleAnrufAbgelehnt(grund) {
  fangeFehler("anruf_abgelehnt", () => anrufZaehler?.abgelehnt.add(1, { grund }));
}

export function schalteScharf({ meter, poolZustand, warteschlangeZustand, leitungsplaetzeBelegung }) {
  const beende = fangeFehler("scharfschalten", () => {
    const beendeAnrufe = anrufMessung(meter);
    const beendeEventloop = eventloopMessung(meter);
    poolMessung(meter, poolZustand);
    warteschlangeMessung(meter, warteschlangeZustand);
    leitungenMessung(meter, leitungsplaetzeBelegung);
    return () => {
      beendeAnrufe();
      beendeEventloop();
    };
  });
  return beende ?? (() => {});
}
