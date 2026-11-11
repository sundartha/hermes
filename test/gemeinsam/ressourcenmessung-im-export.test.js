import { test } from "node:test";
import assert from "node:assert/strict";

import { startServer } from "../helpers.js";
import { starteTelemetrie } from "../../src/utils/telemetrie.js";
import { echteDatenbank } from "./echtes-postgres.js";
import { pgStartUmgebung } from "./pg-start-umgebung.js";
import { messwerte, startEmpfaenger, warteAufExport, wert } from "./otlp-empfaenger.js";

const TOKEN = "t".repeat(20);
const EXPORT_INTERVALL_MS = "50";
const MAX_EVENTLOOP_MS = 1000;

async function mitMessung(umgebung, lauf) {
  const empfaenger = await startEmpfaenger();
  let srv;
  try {
    srv = await startServer({
      env: {
        METRIKEN_OTLP_URL: empfaenger.url,
        METRIKEN_OTLP_TOKEN: TOKEN,
        METRIKEN_INTERVALL_MS: EXPORT_INTERVALL_MS,
        ...umgebung,
      },
    });
    return await lauf({ srv, empfaenger });
  } finally {
    await srv?.stop();
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
  await mitMessung(pgStartUmgebung(datenbank.adresse), async ({ empfaenger }) => {
    const werte = await warteAufExport(empfaenger, (m) => m["hermes.db.pool.open"] && m["hermes.db.pool.waiting"]);
    assert.ok(wert(werte["hermes.db.pool.open"].punkte) >= 1);
    assert.equal(wert(werte["hermes.db.pool.waiting"].punkte), 0);
  });
});

test("Ressourcenmessung B4: ein werfender Pool-Zustand laesst die Event-Loop-Messung weiterlaufen", async () => {
  const empfaenger = await startEmpfaenger();
  let aufrufe = 0;
  const telemetrie = await starteTelemetrie({
    url: empfaenger.url,
    token: TOKEN,
    intervallMs: Number(EXPORT_INTERVALL_MS),
    poolZustand: () => {
      aufrufe += 1;
      if (aufrufe > 1) throw new Error("Pool kaputt");
      return { offen: 1, wartend: 0 };
    },
  });
  try {
    const werte = await warteAufExport(empfaenger, (m) => m["hermes.eventloop.delay.p99"]);
    assert.ok(aufrufe > 1);
    assert.ok(wert(werte["hermes.eventloop.delay.p99"].punkte) >= 0);
  } finally {
    await telemetrie.stoppe();
    await empfaenger.stop();
  }
});
