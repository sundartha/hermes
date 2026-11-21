import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_5451_kunde";
const SID = "CA5451eigenerAnrufOhneZeile";

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

test("leseCallUngebunden(Anbieter-Kennung) liefert den eigenen Anruf aus dem Spiegel, auch ohne Zeile in der Datenbank", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const store = makePgStore(runnerFuer(db));
  await store.init();
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [KUNDE]);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [KUNDE]);
  const call = store.createCall({ direction: "inbound", from: "+4930555000321", to: "+4915112349956", goal: "Test", tenantId: KUNDE, provider: "telnyx" });
  call.twilioSid = SID;
  await store.persistCall(call.id);
  await db.exec("DELETE FROM anruf_schluessel");
  const gelesen = await store.leseCallUngebunden(SID);
  assert.equal(gelesen?.id, call.id);
});
