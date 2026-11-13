import assert from "node:assert/strict";
import { test } from "node:test";

import { makeConfigOverrides, startServer } from "../helpers.js";
import { config } from "../../src/config.js";
import { createQueue } from "../../src/queue/registry.js";
import { OTLP_MESSWERTE_TOKEN as TOKEN } from "./erfundene-geheimnisse.js";
import { echteDatenbank } from "./echtes-postgres.js";
import { startEmpfaenger, warteAufExport, wert } from "./otlp-empfaenger.js";

const { withConfigOverrides } = makeConfigOverrides(config);
const EXPORT_INTERVALL_MS = "50";
const ART = "k4_verdrahtung";
const ANBIETER = ["elevenlabs", "telnyx"];

async function mitServer(umgebung, lauf) {
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
    return await lauf(empfaenger);
  } finally {
    await srv.stop();
    await empfaenger.stop();
  }
}

const anbieterJePunkt = (punkte) => punkte.map((p) => p.attributes.map((a) => `${a.key}=${a.value.stringValue}`).join(","));

test("Serverstart: der Export enthaelt Leitungsbelegung und Kapazitaet je Anbieter ohne weiteres Label", async () => {
  await mitServer({}, async (empfaenger) => {
    const werte = await warteAufExport(empfaenger, (w) => w["hermes.lines.occupied"] && w["hermes.lines.capacity"]);
    for (const name of ["hermes.lines.occupied", "hermes.lines.capacity"]) {
      assert.deepEqual(anbieterJePunkt(werte[name].punkte).sort(), ANBIETER.map((a) => `anbieter=${a}`));
    }
  });
});

test("Serverstart: der Export enthaelt Laenge und aeltestes Alter der Warteschlange", async (t) => {
  const db = await echteDatenbank(t);
  if (!db) return;
  const vorab = withConfigOverrides({ queueBackend: "pgboss" }, () => createQueue({ connectionString: db.adresse }));
  await vorab.enqueue({ kind: ART, payload: {}, idempotencyKey: ART });
  await vorab.stop();
  await mitServer({ QUEUE_BACKEND: "pgboss", DATABASE_URL: db.adresse }, async (empfaenger) => {
    const werte = await warteAufExport(empfaenger, (w) => w["hermes.queue.length"] && w["hermes.queue.oldest_age"]);
    const [laenge] = werte["hermes.queue.length"].punkte;
    assert.equal(wert([laenge]), 1);
    const art = laenge.attributes.find((a) => a.key === "art");
    assert.equal(art.value.stringValue, ART);
    assert.ok(wert(werte["hermes.queue.oldest_age"].punkte) >= 0);
  });
});
