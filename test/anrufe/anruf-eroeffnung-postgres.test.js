import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";

import { BOOTSTRAP_TENANT_ID, makePgStore } from "../pg-helpers.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";

const ZIEL = "+4915112349944";
const ABSENDER = "+4930555000310";

function runnerFuer(pool) {
  return {
    async withClient(arbeit) {
      const client = await pool.connect();
      try {
        return await arbeit({ query: (text, params) => client.query(text, params), exec: (sql) => client.query(sql) });
      } finally {
        client.release();
      }
    },
  };
}

async function mitSpeicher(t, arbeit) {
  const datenbank = await echteDatenbankMitRolle(t);
  if (!datenbank) return;
  await t.test("Ablauf", async (ablauf) => {
    const pool = new pg.Pool({ connectionString: datenbank.adresse });
    ablauf.after(() => pool.end());
    pool.on("error", () => {});
    const store = makePgStore(runnerFuer(pool));
    await store.init();
    await arbeit({ store, pool });
    await store.save();
  });
}

async function legeAn(store, zusatz = {}) {
  const call = store.createCall({
    direction: "outbound",
    from: ABSENDER,
    to: ZIEL,
    goal: "Test",
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: "telnyx",
    ...zusatz,
  });
  await store.persistCall(call.id);
  return call;
}

async function zeile(pool, id) {
  const { rows } = await pool.query(
    `SELECT set_config('app.current_tenant', $1, false)`,
    [BOOTSTRAP_TENANT_ID],
  );
  assert.equal(rows.length, 1);
  const antwort = await pool.query("SELECT status, answered_at, ended_at FROM call WHERE id = $1", [id]);
  return antwort.rows[0];
}

test("ERÖFFNUNG-1: ein nicht angenommener, abgebrochener Anruf ist danach nicht mehr bewacht und trägt den Endstatus", async (t) => {
  await mitSpeicher(t, async ({ store, pool }) => {
  const call = await legeAn(store);
  assert.equal(store.anrufHierBewacht(call.id), true);
  await store.endCallRecord(call.id, "cancelled");
  assert.equal(store.anrufHierBewacht(call.id), false);
  const gespeichert = await zeile(pool, call.id);
  assert.equal(gespeichert.status, "cancelled");
  assert.equal(gespeichert.answered_at, null);
  assert.notEqual(gespeichert.ended_at, null);
  });
});

const LEERLAUF_BEENDEN =
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND usename = current_user AND state = 'idle'";

test("ERÖFFNUNG-4: beendet die Datenbank eine Leerlauf-Verbindung des Pools, bleibt die Datei grün und der Pool arbeitet weiter", async (t) => {
  await mitSpeicher(t, async ({ store, pool }) => {
    const call = await legeAn(store);
    const halter = await pool.connect();
    const leerlauf = await pool.connect();
    leerlauf.release();
    const { rows: beendet } = await halter.query(LEERLAUF_BEENDEN);
    halter.release();
    assert.ok(beendet.length >= 1);
    while (pool.idleCount > 1) await new Promise((weiter) => setImmediate(weiter));
    assert.equal((await zeile(pool, call.id)).status, "active");
  });
});
