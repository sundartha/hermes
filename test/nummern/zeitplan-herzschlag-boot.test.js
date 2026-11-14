import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { echteDatenbank } from "../gemeinsam/echtes-postgres.js";

const ZEITGRENZE_MS = 60_000;
const HTTP_OK = 200;

async function healthz(srv) {
  const antwort = await abrufMitFrist(`${srv.localUrl}/healthz`);
  return { status: antwort.status, koerper: await antwort.json() };
}

test(
  "Herzschlag-Boot: /healthz meldet nach dem Boot mit pgboss keinen überfälligen Zeitplan und danach genau einen, wenn die Zeitplan-Daten fehlen",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const srv = await startServer({ env: { QUEUE_BACKEND: "pgboss", DATABASE_URL: db.adresse } });
    t.after(() => srv.stop());
    const gesund = await healthz(srv);
    assert.equal(gesund.status, HTTP_OK);
    assert.equal(gesund.koerper.zeitplaeneUeberfaellig, undefined);
    const verbindung = await db.verbinden();
    await verbindung.query("DROP SCHEMA pgboss CASCADE");
    const gestoert = await healthz(srv);
    assert.equal(gestoert.status, HTTP_OK);
    assert.equal(gestoert.koerper.zeitplaeneUeberfaellig, 10);
  },
);
