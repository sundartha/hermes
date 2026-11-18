import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_3406_kunde";
const ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164, to_e164, goal, started_at, max_duration_s, provider)
  VALUES ($1, $2, $3, 'outbound', $4, '+4930555000340', '+4915112340600', 'Test', now()::text, 60, 'telnyx')`;

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

async function aufgesetzt() {
  const db = await pgliteAlsRolleOhneSuperuser();
  const init = makePgStore(runnerFuer(db));
  await init.init();
  await db.query("SELECT set_config('app.current_tenant', $1, false)", [KUNDE]);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [KUNDE]);
  const store = makePgStore(runnerFuer(db));
  await store.init();
  return { db, store };
}

async function legeAnruf(db, id, status) {
  await db.query("SELECT set_config('app.current_tenant', $1, false)", [KUNDE]);
  await db.query(ANRUF_SQL, [id, KUNDE, `tok_${id}`, status]);
}

for (const status of ["active", "completed", "failed", "cancelled"]) {
  test(`Anruf mit Zustand ${status} laedt unveraendert`, async () => {
    const { db, store } = await aufgesetzt();
    await legeAnruf(db, `call_3406_${status}`, status);
    const anruf = await store.leseCallUngebunden(`call_3406_${status}`);
    assert.equal(anruf.status, status);
    assert.equal(anruf.id, `call_3406_${status}`);
  });
}

test("Anruf mit unbekanntem Zustand wird beim Lesen abgelehnt, Fehler nennt die Anruf-Id", async () => {
  const { db, store } = await aufgesetzt();
  await legeAnruf(db, "call_3406_bogus", "bogus");
  await assert.rejects(
    () => store.leseCallUngebunden("call_3406_bogus"),
    (err) => err.message.includes("call_3406_bogus") && err.message.includes("bogus"),
  );
});

test("Start-Laden bricht bei unbekanntem Zustand ab und nennt die Anruf-Id", async () => {
  const { db } = await aufgesetzt();
  await legeAnruf(db, "call_3406_ok", "completed");
  await legeAnruf(db, "call_3406_bogus2", "bogus");
  const frisch = makePgStore(runnerFuer(db));
  await assert.rejects(
    () => frisch.init(),
    (err) => err.message.includes("call_3406_bogus2"),
  );
});
