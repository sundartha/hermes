import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID, makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_loeschen_kunde";
const ANDERER = "t_loeschen_anderer";

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

const kontext = (db, tenantId) => db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

async function mandantMitAnrufen(db, tenantId, anrufe) {
  await kontext(db, tenantId);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [tenantId]);
  for (const [id, texte] of Object.entries(anrufe)) {
    await db.query(
      `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
       VALUES ($1, $2, $3, 'inbound', 'completed', now()::text)`,
      [id, tenantId, `tok_${id}`],
    );
    for (const text of texte) {
      await db.query(
        `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1,$2,'caller',$3,now()::text)`,
        [id, tenantId, text],
      );
    }
  }
}

async function anzahl(db, tabelle, tenantId) {
  await kontext(db, tenantId);
  const { rows } = await db.query(`SELECT count(*) AS n FROM ${tabelle} WHERE tenant_id=$1`, [tenantId]);
  return Number(rows[0].n);
}

test("LOESCHEN-RLS-1: unter einer Rolle ohne RLS-Umgehung und fremdem Kontext zaehlt und entfernt eraseTenantData die Anrufe des Kunden, die eines anderen bleiben", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const store = makePgStore(runnerFuer(db));
  await store.init();
  await mandantMitAnrufen(db, KUNDE, { call_k1: ["a", "b"], call_k2: ["c"] });
  await mandantMitAnrufen(db, ANDERER, { call_a1: ["bleibt"] });
  await kontext(db, BOOTSTRAP_TENANT_ID);

  const removed = await store.eraseTenantData(KUNDE);
  await store.drainFlushes();

  assert.equal(removed.calls, 2);
  assert.equal(removed.transcriptSegments, 3);
  assert.equal(await anzahl(db, "call", KUNDE), 0);
  assert.equal(await anzahl(db, "transcript_segment", KUNDE), 0);
  assert.equal(await anzahl(db, "call", ANDERER), 1);
  assert.equal(await anzahl(db, "transcript_segment", ANDERER), 1);
});
