import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { echtWarten } from "../echt-warten.js";
import { startServer } from "../helpers.js";
import { echteDatenbank } from "./echtes-postgres.js";

const TOKEN = "t".repeat(20);
const EXPORT_INTERVALL_MS = "50";
const WARTE_FRIST_MS = 8000;
const MAX_EVENTLOOP_MS = 1000;
const HTTP_OK = 200;
const PROBEN_ABSTAND_MS = 60;
const ladeMessung = () => import("../../src/utils/betriebsmessung.js");

function startEmpfaenger() {
  const exporte = [];
  const wartende = [];
  const empfaenger = http.createServer((req, res) => {
    const teile = [];
    req.on("data", (teil) => teile.push(teil));
    req.on("end", () => {
      exporte.push(JSON.parse(Buffer.concat(teile).toString("utf8")));
      for (const wartender of wartende.splice(0)) wartender();
      res.writeHead(HTTP_OK, { "content-type": "application/json" }).end("{}");
    });
  });
  return new Promise((resolve) => {
    empfaenger.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${empfaenger.address().port}/otlp`,
        exporte,
        wartende,
        stop: () => new Promise((fertig) => empfaenger.close(fertig)),
      });
    });
  });
}

const metrikenVon = (export_) => export_.resourceMetrics.flatMap((r) => r.scopeMetrics).flatMap((s) => s.metrics);

const messwerte = (export_) =>
  Object.fromEntries(
    metrikenVon(export_)
      .filter((m) => m.gauge)
      .map((m) => [m.name, { einheit: m.unit, punkte: m.gauge.dataPoints }]),
  );

function warteAufExport(empfaenger, pruefung) {
  return new Promise((resolve, reject) => {
    AbortSignal.timeout(WARTE_FRIST_MS).addEventListener("abort", () => reject(new Error("kein passender Export")));
    const pruefen = () => {
      const treffer = empfaenger.exporte.map(messwerte).findLast(pruefung);
      if (treffer) resolve(treffer);
      else empfaenger.wartende.push(pruefen);
    };
    pruefen();
  });
}

const wert = (punkte) => Number(punkte[0].asDouble ?? punkte[0].asInt);

async function mitMessung(umgebung, lauf) {
  const empfaenger = await startEmpfaenger();
  const srv = await startServer({
    env: {
      METRIKEN_OTLP_URL: empfaenger.url,
      METRIKEN_OTLP_TOKEN: TOKEN,
      METRIKEN_INTERVALL_MS: EXPORT_INTERVALL_MS,
      ...umgebung,
    },
  });
  try {
    return await lauf({ srv, empfaenger });
  } finally {
    await srv.stop();
    await empfaenger.stop();
  }
}

test("Ressourcenmessung S17: Event-Loop-Verzoegerung p99 und Hoechstwert in Millisekunden", async () => {
  await mitMessung({}, async ({ empfaenger }) => {
    const werte = await warteAufExport(empfaenger, (m) => m["hermes.eventloop.delay.p99"] && m["hermes.eventloop.delay.max"]);
    const p99 = werte["hermes.eventloop.delay.p99"];
    const hoechst = werte["hermes.eventloop.delay.max"];
    assert.equal(p99.einheit, "ms");
    assert.equal(hoechst.einheit, "ms");
    assert.ok(wert(p99.punkte) >= 0 && wert(p99.punkte) <= MAX_EVENTLOOP_MS);
    assert.ok(wert(hoechst.punkte) <= MAX_EVENTLOOP_MS);
    assert.ok(wert(hoechst.punkte) >= wert(p99.punkte));
    assert.deepEqual(p99.punkte[0].attributes, []);
  });
});

test("Ressourcenmessung S19: beim JSON-Speicher gibt es keine Pool-Messwerte", async () => {
  await mitMessung({}, async ({ empfaenger }) => {
    await warteAufExport(empfaenger, (m) => m["hermes.eventloop.delay.p99"]);
    const alle = empfaenger.exporte.flatMap((e) => Object.keys(messwerte(e)));
    assert.ok(!alle.includes("hermes.db.pool.open"));
    assert.ok(!alle.includes("hermes.db.pool.waiting"));
  });
});

test("Ressourcenmessung S18: bei Postgres meldet der Export offene und wartende Verbindungen", async (t) => {
  const datenbank = await echteDatenbank(t);
  if (!datenbank) return;
  await mitMessung({ STORE_BACKEND: "pg", DATABASE_URL: datenbank.adresse }, async ({ empfaenger }) => {
    const werte = await warteAufExport(empfaenger, (m) => m["hermes.db.pool.open"] && m["hermes.db.pool.waiting"]);
    assert.ok(wert(werte["hermes.db.pool.open"].punkte) >= 1);
    assert.equal(wert(werte["hermes.db.pool.waiting"].punkte), 0);
  });
});

test("Ressourcenmessung B4: ein werfender Meter bricht das Scharfschalten nicht ab", async () => {
  const { schalteScharf } = await ladeMessung();
  const meter = {
    createObservableGauge() {
      throw new Error("Meter kaputt");
    },
    addBatchObservableCallback() {
      throw new Error("Meter kaputt");
    },
  };
  assert.doesNotThrow(() => schalteScharf({ meter, poolZustand: () => null }));
});

test("Ressourcenmessung B4: ein werfender Pool-Zustand bricht die Messung nicht ab", async () => {
  const { schalteScharf } = await ladeMessung();
  const rueckrufe = [];
  const meter = {
    createObservableGauge: (name) => ({ name }),
    addBatchObservableCallback: (rueckruf) => rueckrufe.push(rueckruf),
  };
  let aufrufe = 0;
  const beende = schalteScharf({
    meter,
    poolZustand: () => {
      aufrufe += 1;
      if (aufrufe > 1) throw new Error("Pool kaputt");
      return { offen: 1, wartend: 0 };
    },
  });
  const beobachtet = [];
  const ergebnis = { observe: (instrument, wert_) => beobachtet.push([instrument.name, wert_]) };
  assert.doesNotThrow(() => rueckrufe.forEach((rueckruf) => rueckruf(ergebnis)));
  assert.deepEqual(beobachtet, []);
  beende();
});

test("Ressourcenmessung S17: jede Sammlung meldet beide Werte aus einem Stand und beginnt danach neu", async () => {
  const { schalteScharf } = await ladeMessung();
  const rueckrufe = [];
  const meter = {
    createObservableGauge: (name) => ({ name }),
    addBatchObservableCallback: (rueckruf) => rueckrufe.push(rueckruf),
  };
  const beende = schalteScharf({ meter, poolZustand: () => null });
  await echtWarten(PROBEN_ABSTAND_MS);
  const beobachtet = [];
  const ergebnis = { observe: (instrument, wert_) => beobachtet.push([instrument.name, wert_]) };
  rueckrufe[0](ergebnis);
  assert.deepEqual(beobachtet.map(([name]) => name), ["hermes.eventloop.delay.p99", "hermes.eventloop.delay.max"]);
  assert.ok(beobachtet[0][1] > 0 && beobachtet[1][1] >= beobachtet[0][1] && beobachtet[1][1] <= MAX_EVENTLOOP_MS);
  rueckrufe[0](ergebnis);
  assert.equal(beobachtet.length, 2);
  beende();
});
