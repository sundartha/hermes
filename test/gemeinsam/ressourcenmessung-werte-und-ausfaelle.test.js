import { test, mock } from "node:test";
import assert from "node:assert/strict";
import perfHooks from "node:perf_hooks";
import { syncBuiltinESMExports } from "node:module";

import { starteTelemetrie } from "../../src/utils/telemetrie.js";
import { messwerte, startEmpfaenger, warteAufExport, wert } from "./otlp-empfaenger.js";

const TOKEN = "t".repeat(20);
const EXPORT_INTERVALL_MS = 50;
const P99_NS = 5_000_000;
const MAX_NS = 7_000_000;
const NAMEN = {
  p99: "hermes.eventloop.delay.p99",
  max: "hermes.eventloop.delay.max",
  offen: "hermes.db.pool.open",
  wartend: "hermes.db.pool.waiting",
};
const ECHTES = perfHooks.monitorEventLoopDelay;
const POOL = () => ({ offen: 3, wartend: 2 });

function falschesHistogramm({ count = 3, percentile = () => P99_NS } = {}) {
  const aufrufe = { enable: 0, disable: 0, reset: 0 };
  return {
    aufrufe,
    count,
    max: MAX_NS,
    percentile,
    enable: () => (aufrufe.enable += 1),
    disable: () => (aufrufe.disable += 1),
    reset: () => (aufrufe.reset += 1),
  };
}

function ersetzeZaehler(erzeuger) {
  perfHooks.monitorEventLoopDelay = erzeuger;
  syncBuiltinESMExports();
}

async function mitMessung(optionen, lauf) {
  const empfaenger = await startEmpfaenger();
  const warnungen = mock.method(console, "warn", () => {});
  const telemetrie = await starteTelemetrie({
    url: empfaenger.url,
    token: TOKEN,
    intervallMs: EXPORT_INTERVALL_MS,
    ...optionen,
  });
  try {
    return await lauf({ empfaenger, telemetrie, meldungen: () => warnungen.mock.calls.map((a) => a.arguments[0]) });
  } finally {
    await telemetrie.stoppe();
    await empfaenger.stop();
    warnungen.mock.restore();
    ersetzeZaehler(ECHTES);
  }
}

const alleNamen = (empfaenger) => new Set(empfaenger.exporte.flatMap((e) => Object.keys(messwerte(e))));

test("Ressourcenmessung S17: Werte, Einheiten und Namen der Messpunkte stimmen genau", async () => {
  const histogramm = falschesHistogramm();
  ersetzeZaehler(() => histogramm);
  await mitMessung({ poolZustand: POOL }, async ({ empfaenger, telemetrie, meldungen }) => {
    const werte = await warteAufExport(empfaenger, (m) => m[NAMEN.p99] && m[NAMEN.max] && m[NAMEN.offen] && m[NAMEN.wartend]);
    assert.equal(wert(werte[NAMEN.p99].punkte), P99_NS / 1e6);
    assert.equal(wert(werte[NAMEN.max].punkte), MAX_NS / 1e6);
    assert.equal(werte[NAMEN.p99].einheit, "ms");
    assert.equal(werte[NAMEN.max].einheit, "ms");
    assert.equal(wert(werte[NAMEN.offen].punkte), 3);
    assert.equal(wert(werte[NAMEN.wartend].punkte), 2);
    assert.deepEqual(meldungen(), []);
    assert.ok(histogramm.aufrufe.enable >= 1);
    assert.ok(histogramm.aufrufe.reset >= 1);
    assert.equal(histogramm.aufrufe.disable, 0);
    await telemetrie.stoppe();
    assert.equal(histogramm.aufrufe.disable, 1);
  });
});

test("Ressourcenmessung S17: ohne Messungen im Intervall gibt es keinen Event-Loop-Wert", async () => {
  ersetzeZaehler(() => falschesHistogramm({ count: 0 }));
  await mitMessung({ poolZustand: POOL }, async ({ empfaenger }) => {
    await warteAufExport(empfaenger, (m) => m[NAMEN.offen]);
    const namen = alleNamen(empfaenger);
    assert.ok(!namen.has(NAMEN.p99));
    assert.ok(!namen.has(NAMEN.max));
  });
});

test("Ressourcenmessung S19: ohne Pool-Zustand gibt es keine Pool-Messwerte und keine Warnung", async () => {
  ersetzeZaehler(() => falschesHistogramm());
  await mitMessung({}, async ({ empfaenger, meldungen }) => {
    await warteAufExport(empfaenger, (m) => m[NAMEN.p99]);
    await warteAufExport(empfaenger, (m) => m[NAMEN.p99], empfaenger.exporte.length);
    const namen = alleNamen(empfaenger);
    assert.ok(!namen.has(NAMEN.offen));
    assert.ok(!namen.has(NAMEN.wartend));
    assert.deepEqual(meldungen(), []);
  });
});

const POOL_AUSFAELLE = [
  ["ein Fehler mit Meldung", new Error("Pool kaputt"), "Pool kaputt"],
  ["ein Wurf ohne Fehlerobjekt", undefined, "undefined"],
];

for (const [name, geworfen, text] of POOL_AUSFAELLE) {
  test(`Ressourcenmessung B4: wirft der Pool-Zustand (${name}), steht die Warnung im Log und der Event-Loop-Wert kommt weiter`, async () => {
    ersetzeZaehler(() => falschesHistogramm());
    let aufrufe = 0;
    const werfend = () => {
      aufrufe += 1;
      if (aufrufe === 1) return { offen: 1, wartend: 0 };
      throw geworfen;
    };
    await mitMessung({ poolZustand: werfend }, async ({ empfaenger, meldungen }) => {
      const werte = await warteAufExport(empfaenger, (m) => m[NAMEN.p99]);
      assert.equal(wert(werte[NAMEN.p99].punkte), P99_NS / 1e6);
      assert.ok(meldungen().includes(`[betriebsmessung] pool fehlgeschlagen: ${text}`));
    });
  });
}

test("Ressourcenmessung B4: scheitert die Event-Loop-Messung, steht die Warnung im Log und der Pool wird weiter gemeldet", async () => {
  ersetzeZaehler(() =>
    falschesHistogramm({
      percentile: () => {
        throw new Error("Messung kaputt");
      },
    }),
  );
  await mitMessung({ poolZustand: POOL }, async ({ empfaenger, meldungen }) => {
    const werte = await warteAufExport(empfaenger, (m) => m[NAMEN.offen]);
    assert.equal(wert(werte[NAMEN.offen].punkte), 3);
    assert.ok(meldungen().includes("[betriebsmessung] eventloop fehlgeschlagen: Messung kaputt"));
  });
});

test("Ressourcenmessung B4: scheitert das Scharfschalten, steht die Warnung im Log und Telemetrie und Stopp laufen weiter", async () => {
  ersetzeZaehler(() => {
    throw new Error("kein Zaehler");
  });
  await mitMessung({ poolZustand: POOL }, async ({ telemetrie, meldungen }) => {
    assert.ok(telemetrie.aktiv);
    assert.deepEqual(meldungen(), ["[betriebsmessung] scharfschalten fehlgeschlagen: kein Zaehler"]);
    await assert.doesNotReject(telemetrie.stoppe());
  });
});
