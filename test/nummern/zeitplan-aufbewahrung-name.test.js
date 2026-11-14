import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { echteDatenbank } from "../gemeinsam/echtes-postgres.js";

const ZEITGRENZE_MS = 60_000;
const HTTP_OK = 200;
const ZEITPLAENE = "SELECT name, cron FROM pgboss.schedule WHERE name = 'zeitplan_aufbewahrung' ORDER BY name";

test(
  "Zeitplan-Aufbewahrung: der Boot mit pgboss legt genau einen Zeitplan namens aufbewahrung mit Takt alle 6 Stunden an",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const srv = await startServer({ env: { QUEUE_BACKEND: "pgboss", DATABASE_URL: db.adresse } });
    t.after(() => srv.stop());
    assert.equal((await abrufMitFrist(`${srv.localUrl}/healthz`)).status, HTTP_OK);
    const verbindung = await db.verbinden();
    const { rows } = await verbindung.query(ZEITPLAENE);
    assert.deepEqual(rows, [{ name: "zeitplan_aufbewahrung", cron: "0 */6 * * *" }]);
  },
);

const SWEEP_NAMEN = [
  "cost-truing",
  "number-month",
  "cost-cross-check",
  "outage-recovery",
  "outage-selftest",
  "outage-hold-escalation",
  "paid-without-number",
  "provision-retry",
  "price-drift",
];

test(
  "Zeitplan-Sweep-Takt: der Boot mit pgboss legt die neun Sweep-Zeitpläne mit dem Takt der Konfiguration an",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const srv = await startServer({ env: { QUEUE_BACKEND: "pgboss", DATABASE_URL: db.adresse } });
    t.after(() => srv.stop());
    assert.equal((await abrufMitFrist(`${srv.localUrl}/healthz`)).status, HTTP_OK);
    const verbindung = await db.verbinden();
    const { rows } = await verbindung.query("SELECT name, cron FROM pgboss.schedule ORDER BY name");
    const erwartet = SWEEP_NAMEN.map((name) => ({ name: `zeitplan_${name}`, cron: "0 */1 * * *" }));
    assert.deepEqual(
      rows.filter((zeile) => zeile.name !== "zeitplan_aufbewahrung"),
      erwartet.sort((a, b) => a.name.localeCompare(b.name)),
    );
  },
);
