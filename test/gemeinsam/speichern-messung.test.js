import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { makePgTestStore } from "../pg-helpers.js";
import { echtWarten } from "../echt-warten.js";
import { startServer } from "../helpers.js";
import { messwerte, startEmpfaenger, warteAufExport } from "./otlp-empfaenger.js";
import { starteTelemetrie } from "../../src/utils/telemetrie.js";
import { messeSpeichern, schalteScharf } from "../../src/utils/betriebsmessung.js";
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
  runner.withClient = async (arbeit) => {
    await echtWarten(ms);
    return echt(arbeit);
  };
}

test("Speichern-Messung 1: gelungene Speicherungen stehen als Histogramm in Sekunden ohne Label im Export", async () => {
  await mitMessung(async (umgebung) => {
    verzoegere(umgebung.runner, VERZOEGERUNG_MS);
    for (let i = 0; i < SPEICHERUNGEN; i += 1) await umgebung.store.save();
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
    umgebung.runner.withClient = async () => {
      throw new Error("Verbindung weg");
    };
    await umgebung.store.save();
    await assert.rejects(() => umgebung.store.drainFlushes(), { message: "Verbindung weg" });
    assert.deepEqual(umgebung.fehlerLog.mock.calls.at(-1).arguments, ["[pg] Flush fehlgeschlagen:", "Verbindung weg"]);
    const export_ = await letzterExport(umgebung);
    const [zaehler, weitere] = summen(export_, FEHLER);
    assert.equal(weitere, undefined);
    assert.equal(zaehler.sum.dataPoints.length, 1);
    assert.equal(Number(zaehler.sum.dataPoints[0].asInt ?? zaehler.sum.dataPoints[0].asDouble), 1);
    assert.deepEqual(zaehler.sum.dataPoints[0].attributes, []);
    const punkt = histogramme(export_, DAUER)[0].histogram.dataPoints[0];
    assert.equal(Number(punkt.count), 1);
    assert.deepEqual(punkt.attributes, []);
  });
});

test("Speichern-Messung 3: gelungene und fehlgeschlagene Speicherungen zaehlen zusammen in der Dauer, der Fehlerzaehler nur die fehlgeschlagene", async () => {
  await mitMessung(async (umgebung) => {
    const echt = umgebung.runner.withClient;
    await umgebung.store.save();
    umgebung.runner.withClient = async () => {
      throw new Error("kaputt");
    };
    await umgebung.store.save();
    umgebung.runner.withClient = echt;
    await umgebung.store.save();
    const export_ = await letzterExport(umgebung);
    assert.equal(Number(histogramme(export_, DAUER)[0].histogram.dataPoints[0].count), SPEICHERUNGEN);
    const punkt = summen(export_, FEHLER)[0].sum.dataPoints[0];
    assert.equal(Number(punkt.asInt ?? punkt.asDouble), 1);
  });
});

test("Speichern-Messung 4: der Export enthaelt weder Nummer, Kennung noch Inhalt", async () => {
  await mitMessung(async (umgebung) => {
    await umgebung.store.save();
    const export_ = await letzterExport(umgebung);
    const gemessen = [...histogramme(export_, DAUER), ...summen(export_, FEHLER)];
    assert.ok(gemessen.length >= 1);
    const text = JSON.stringify(gemessen);
    assert.ok(!/\+\d{6,}|call_|tenant|user/i.test(text), text);
    assert.deepEqual(Object.keys(messwerte(export_)).filter((n) => n.startsWith("hermes.store")), []);
  });
});

function werfenderMesser(versuche) {
  const werfen = () => {
    versuche.anzahl += 1;
    throw new Error("Messung kaputt");
  };
  return {
    createObservableGauge: () => ({}),
    addBatchObservableCallback: () => {},
    createCounter: () => ({ add: werfen }),
    createHistogram: () => ({ record: werfen }),
  };
}

test("Speichern-Messung 5: eine werfende Messung aendert Ergebnis und Fehler des Speicherns nicht", async () => {
  const meldungen = mock.method(console, "warn", () => {});
  const versuche = { anzahl: 0 };
  const beende = schalteScharf({ meter: werfenderMesser(versuche), poolZustand: () => null, warteschlangeZustand: async () => null });
  try {
    const reihenfolge = [];
    const ergebnis = { id: 1 };
    const geliefert = await messeSpeichern(async () => {
      reihenfolge.push("arbeit");
      return ergebnis;
    });
    assert.equal(geliefert, ergebnis);
    const fehler = new Error("Flush kaputt");
    await assert.rejects(
      () => messeSpeichern(async () => { throw fehler; }),
      (geworfen) => geworfen === fehler,
    );
    assert.deepEqual(reihenfolge, ["arbeit"]);
    assert.equal(versuche.anzahl, 2);
    assert.ok(meldungen.mock.calls.some((a) => String(a.arguments[0]).includes("speichern fehlgeschlagen")));
    beende();
    await messeSpeichern(async () => "danach");
    assert.equal(versuche.anzahl, 2);
  } finally {
    meldungen.mock.restore();
  }
});

test("Speichern-Messung 6: ohne Telemetrie laeuft das Speichern unveraendert", async () => {
  const fehler = new Error("ohne Messung");
  assert.equal(await messeSpeichern(async () => "ok"), "ok");
  await assert.rejects(
    () => messeSpeichern(async () => { throw fehler; }),
    (geworfen) => geworfen === fehler,
  );
  const { store } = await makePgTestStore();
  await store.save();
  await store.drainFlushes();
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
