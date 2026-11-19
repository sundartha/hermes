import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore, BOOTSTRAP_TENANT_ID, makePgTestStore } from "../pg-helpers.js";

function runnerFuer(db, vorQuery) {
  return {
    withClient: (fn) =>
      fn({
        query: (text, params) => {
          vorQuery(text, params);
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
}

test("Schreibt eine andere Instanz die Marke waehrend des Abrufs in die Datenbank, liefert der Abruf den Anruf genau einmal und zaehlt ihn nicht doppelt", async () => {
  const { db } = await makePgTestStore();
  let lesungen = 0;
  let callId = null;
  const leser = makePgStore(
    runnerFuer(db, (text) => {
      if (!/FROM call .*inbox_entry_at IS NOT NULL/s.test(text)) return;
      lesungen += 1;
      if (lesungen === 2) db.query(`UPDATE call SET inbox_entry_at = $1 WHERE id = $2`, ["2026-01-01T10:00:00.000Z", callId]);
    }),
  );
  await leser.init();
  const call = leser.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  callId = call.id;
  await leser.persistCall(callId);
  await leser.markInboxEntry(callId, true);
  await db.query(`UPDATE call SET inbox_entry_at = NULL WHERE id = $1`, [callId]);
  lesungen = 0;
  const seite = await leser.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  assert.deepEqual(seite.entries.map((e) => e.call_id), [callId]);
  assert.equal(seite.marked, 1);
  assert.equal(seite.remaining, 0);
});
