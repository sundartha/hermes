import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID, makePgTestStore } from "../pg-helpers.js";
import { speicherBereiche } from "../../src/store.js";

const ZEILEN_LESEN = "FROM call WHERE tenant_id";
const MINUTE_MS = 60_000;
const BUCKET = "not-placed:invite-403";

const ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164, to_e164, goal,
  started_at, ended_at, max_duration_s, provider, failure_reason)
  VALUES ($1, $2, $3, 'outbound', 'failed', '+4930555000001', '+4915155512345', 'Testziel', $4, $5, 600, 'telnyx', $6)`;

async function legeAnrufAnderenInstanzAn(db, id) {
  const jetzt = new Date(Date.now() - MINUTE_MS).toISOString();
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
  await db.query(ANRUF_SQL, [id, BOOTSTRAP_TENANT_ID, `tok_${id}`, jetzt, jetzt, `${BUCKET}-D51`]);
}

async function offeneCodes(db) {
  const { rows } = await db.query("SELECT code FROM outage_alert WHERE closed_at IS NULL ORDER BY code");
  return rows.map(({ code }) => code);
}

async function mitZweiteInstanz(lauf) {
  const { store, db, runner } = await makePgTestStore();
  let an = false;
  const client = {
    query: async (text, params) => {
      if (an && text.includes(ZEILEN_LESEN)) throw new Error("ausfall-lesen-ausgefallen");
      return db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  runner.withClient = (fn) => fn(client);
  return lauf({ db, store, lesefehler: (wert) => { an = wert; } });
}

test("AUSFALL-SQL-ZUSTAND: der Zustand des Ausfallberichts enthaelt Anrufe einer anderen Instanz und wirft bei Lesefehler", async () => {
  await mitZweiteInstanz(async ({ db, store, lesefehler }) => {
    await legeAnrufAnderenInstanzAn(db, "call_ausfall_zustand");
    const { ausfall } = speicherBereiche(store);
    const zustand = await ausfall.offeneAusfallZustand();
    assert.deepEqual(zustand.calls.map((anruf) => anruf.id), ["call_ausfall_zustand"]);
    assert.deepEqual(zustand.outageAlerts, []);
    assert.equal(store.load().calls.length, 0);
    lesefehler(true);
    await assert.rejects(ausfall.offeneAusfallZustand(), /ausfall-lesen-ausgefallen/);
  });
});

test("AUSFALL-SQL-URTEIL: das Urteil sieht Anrufe einer anderen Instanz, bei Lesefehler wirft es und setzt keinen Marker", async () => {
  await mitZweiteInstanz(async ({ db, store, lesefehler }) => {
    await legeAnrufAnderenInstanzAn(db, "call_ausfall_urteil");
    const { ausfall } = speicherBereiche(store);
    const gesehen = [];
    const eingabe = {
      bucket: BUCKET,
      nowMs: Date.now(),
      beurteile: ({ calls }) => {
        gesehen.push(...calls.map((anruf) => anruf.id));
        return "alarm";
      },
      istAlarm: (ergebnis) => ergebnis === "alarm",
    };
    lesefehler(true);
    await assert.rejects(ausfall.urteilClaimen(eingabe), /ausfall-lesen-ausgefallen/);
    assert.deepEqual(gesehen, []);
    assert.deepEqual(await offeneCodes(db), []);
    lesefehler(false);
    assert.equal(await ausfall.urteilClaimen(eingabe), "alarm");
    assert.deepEqual(gesehen, ["call_ausfall_urteil"]);
    assert.deepEqual(await offeneCodes(db), [BUCKET]);
  });
});
