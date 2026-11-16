import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID, legeMandantAn, macheRueckfrageSql, makePgTestStore } from "../pg-helpers.js";

const MANDANT = "t_kla_kunde";
const KONTEXT_SQL = `SELECT current_setting('app.current_tenant', true) AS mandant`;

test("Nach dem Lesen der Rueckfrage bleibt der Mandantenkontext nicht auf der Verbindung stehen", async () => {
  const { store, db, runner } = await makePgTestStore();
  await legeMandantAn(store, MANDANT);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
  const ergebnis = await macheRueckfrageSql({ runner }).lesen("call_kla_unbekannt", MANDANT, null);
  assert.deepEqual(ergebnis, { consult: null, status: null });
  const { rows } = await db.query(KONTEXT_SQL);
  assert.equal(rows[0].mandant, BOOTSTRAP_TENANT_ID);
});
