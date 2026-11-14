import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { makePgTestStore } from "../pg-helpers.js";
import { echtWarten } from "../echt-warten.js";
import { startServer } from "../helpers.js";
import { messwerte, startEmpfaenger, warteAufExport } from "./otlp-empfaenger.js";
import { starteTelemetrie } from "../../src/utils/telemetrie.js";
import { OTLP_MESSWERTE_TOKEN as TOKEN } from "./erfundene-geheimnisse.js";

const DAUER = "hermes.store.save.duration";
const FEHLER = "hermes.store.save.failed";
const VERZOEGERUNG_MS = 120;
const OBERGRENZE_S = 5;
const MS_JE_S = 1000;
const SPEICHERUNGEN = 3;

const metrikenVon = (export_) => export_.resourceMetrics.flatMap((r) => r.scopeMetrics).flatMap((s) => s.metrics);
const histogramme = (export_, name) => metrikenVon(export_).filter((m) => m.name === name && m.histogram);
const summen = (export_, name) => metrikenVon(export_).filter((m) => m.name === name && m.sum);
const histogrammPunkte = (export_, name) => histogramme(export_, name).flatMap((m) => m.histogram.dataPoints);
const summenPunkte = (export_, name) => summen(export_, name).flatMap((m) => m.sum.dataPoints);
const zahl = (punkt) => Number(punkt.asInt ?? punkt.asDouble);
const setzeVerbindung = (runner, verbindung) => Object.assign(runner, { withClient: verbindung });
const wirfFehler = (text) => async () => {
  throw new Error(text);
};

async function mitMessung(lauf) {
  const empfaenger = await startEmpfaenger();
  const meldungen = mock.method(console, "warn", () => {});
  const fehlerLog = mock.method(console, "error", () => {});
  const speicher = await makePgTestStore();
  const telemetrie = await starteTelemetrie({ url: empfaenger.url, token: TOKEN, intervallMs: 60_000 });
  try {
    return await lauf({ ...speicher, empfaenger, telemetrie, fehlerLog });
  } finally {
    await telemetrie.stoppe();
    await empfaenger.stop();
    meldungen.mock.restore();
    fehlerLog.mock.restore();
  }
}

async function letzterExport({ telemetrie, empfaenger }) {
  await telemetrie.spuele();
  await warteAufExport(empfaenger, () => true);
  return empfaenger.exporte.at(-1);
}

function verzoegere(runner, ms) {
  const echt = runner.withClient;
  setzeVerbindung(runner, async (arbeit) => {
    await echtWarten(ms);
    return echt(arbeit);
  });
}

test("Speichern-Messung 1: gelungene Speicherungen stehen als Histogramm in Sekunden ohne Label im Export", async () => {
  await mitMessung(async (umgebung) => {
    const { store, runner } = umgebung;
    verzoegere(runner, VERZOEGERUNG_MS);
    for (let i = 0; i < SPEICHERUNGEN; i += 1) await store.save();
    const export_ = await letzterExport(umgebung);
    const [metrik, weitere] = histogramme(export_, DAUER);
    assert.equal(weitere, undefined);
    assert.equal(metrik.unit, "s");
    assert.equal(metrik.histogram.dataPoints.length, 1);
    const punkt = metrik.histogram.dataPoints[0];
    assert.deepEqual(punkt.attributes, []);
    assert.equal(Number(punkt.count), SPEICHERUNGEN);
    assert.ok(punkt.sum >= (SPEICHERUNGEN * VERZOEGERUNG_MS) / MS_JE_S / 2, `Summe ${punkt.sum}`);
    assert.ok(punkt.sum < OBERGRENZE_S, `Summe ${punkt.sum}`);
    assert.deepEqual(summen(export_, FEHLER), []);
  });
});

test("Speichern-Messung 2: ein fehlgeschlagenes Speichern zaehlt 1 ohne Label, geht in die Dauer ein und der Fehler bleibt", async () => {
  await mitMessung(async (umgebung) => {
    const { store, runner, fehlerLog } = umgebung;
    setzeVerbindung(runner, wirfFehler("Verbindung weg"));
    await store.save();
    await assert.rejects(() => store.drainFlushes(), { message: "Verbindung weg" });
    const letzterAufruf = fehlerLog.mock.calls.at(-1);
    assert.deepEqual(letzterAufruf.arguments, ["[pg] Flush fehlgeschlagen:", "Verbindung weg"]);
    const export_ = await letzterExport(umgebung);
    const zaehler = summenPunkte(export_, FEHLER);
    assert.equal(zaehler.length, 1);
    assert.equal(zahl(zaehler[0]), 1);
    assert.deepEqual(zaehler[0].attributes, []);
    const dauer = histogrammPunkte(export_, DAUER);
    assert.equal(dauer.length, 1);
    assert.equal(Number(dauer[0].count), 1);
    assert.deepEqual(dauer[0].attributes, []);
  });
});

test("Speichern-Messung 3: gelungene und fehlgeschlagene Speicherungen zaehlen zusammen in der Dauer, der Fehlerzaehler nur die fehlgeschlagene", async () => {
  await mitMessung(async (umgebung) => {
    const { store, runner } = umgebung;
    const echt = runner.withClient;
    await store.save();
    setzeVerbindung(runner, wirfFehler("kaputt"));
    await store.save();
    setzeVerbindung(runner, echt);
    await store.save();
    const export_ = await letzterExport(umgebung);
    assert.equal(Number(histogrammPunkte(export_, DAUER)[0].count), SPEICHERUNGEN);
    assert.equal(zahl(summenPunkte(export_, FEHLER)[0]), 1);
  });
});

test("Speichern-Messung 4: der Export enthaelt weder Nummer, Kennung noch Inhalt", async () => {
  await mitMessung(async (umgebung) => {
    const { store } = umgebung;
    await store.save();
    const export_ = await letzterExport(umgebung);
    const gemessen = [...histogramme(export_, DAUER), ...summen(export_, FEHLER)];
    assert.ok(gemessen.length >= 1);
    const text = JSON.stringify(gemessen);
    assert.ok(!/\+\d{6,}|call_|tenant|user/i.test(text), text);
    assert.deepEqual(Object.keys(messwerte(export_)).filter((n) => n.startsWith("hermes.store")), []);
  });
});

async function werfendeInstrumente() {
  const { MeterProvider } = await import("@opentelemetry/sdk-metrics");
  const messer = new MeterProvider().getMeter("probe");
  const werfen = () => {
    throw new Error("Messung kaputt");
  };
  return [
    mock.method(Object.getPrototypeOf(messer.createHistogram("probe.h")), "record", werfen),
    mock.method(Object.getPrototypeOf(messer.createCounter("probe.c")), "add", werfen),
  ];
}

const speichernWarnungen = (meldungen) =>
  meldungen.mock.calls.filter((a) => String(a.arguments[0]).includes("speichern fehlgeschlagen"));

test("Speichern-Messung 5: eine werfende Messung aendert Ergebnis und Fehler des Speicherns nicht", async () => {
  const instrumente = await werfendeInstrumente();
  try {
    await mitMessung(async (umgebung) => {
      const warnungen = mock.method(console, "warn", () => {});
      const aufrufe = [];
      const { store, runner } = umgebung;
      const echt = runner.withClient;
      setzeVerbindung(runner, (arbeit) => {
        aufrufe.push("flush");
        return echt(arbeit);
      });
      await store.save();
      await store.drainFlushes();
      assert.deepEqual(aufrufe, ["flush"]);
      assert.equal(speichernWarnungen(warnungen).length, 1);
      setzeVerbindung(runner, wirfFehler("Flush kaputt"));
      await store.save();
      await assert.rejects(() => store.drainFlushes(), { message: "Flush kaputt" });
      assert.equal(speichernWarnungen(warnungen).length, 2);
      warnungen.mock.restore();
    });
  } finally {
    instrumente.forEach((i) => i.mock.restore());
  }
});

test("Speichern-Messung 6: ohne Telemetrie laeuft das Speichern unveraendert und misst nichts", async () => {
  const instrumente = await werfendeInstrumente();
  const warnungen = mock.method(console, "warn", () => {});
  try {
    const { store, runner } = await makePgTestStore();
    await store.save();
    await store.drainFlushes();
    setzeVerbindung(runner, wirfFehler("ohne Messung"));
    await store.save();
    await assert.rejects(() => store.drainFlushes(), { message: "ohne Messung" });
    assert.equal(speichernWarnungen(warnungen).length, 0);
  } finally {
    instrumente.forEach((i) => i.mock.restore());
    warnungen.mock.restore();
  }
});

test("Speichern-Messung 7: mit dem JSON-Speicher entstehen beide Metriken nicht", async () => {
  const empfaenger = await startEmpfaenger();
  let srv;
  try {
    srv = await startServer({
      env: { METRIKEN_OTLP_URL: empfaenger.url, METRIKEN_OTLP_TOKEN: TOKEN, METRIKEN_INTERVALL_MS: "50" },
    });
    await warteAufExport(empfaenger, (m) => m["hermes.eventloop.delay.p99"]);
    const namen = empfaenger.exporte.flatMap(metrikenVon).map((m) => m.name);
    assert.ok(!namen.includes(DAUER));
    assert.ok(!namen.includes(FEHLER));
  } finally {
    await srv?.stop();
    await empfaenger.stop();
  }
});
