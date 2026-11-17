import assert from "node:assert/strict";
import { test } from "node:test";

import * as speicher from "../../src/store.js";
import { legeMandantAn, makePgTestStore } from "../pg-helpers.js";

const MANDANT = "t_marker_kunde";
const ERSTER_ZEITPUNKT = "2026-11-17T10:00:00.000Z";
const ZWEITER_ZEITPUNKT = "2026-11-17T10:05:00.000Z";

test("Anrufstart-Marker (Postgres): der erste Eintrag gilt, jeder weitere meldet false und aendert nichts", async () => {
  const { store, db, runner } = await makePgTestStore();
  await legeMandantAn(store, MANDANT);
  const call = store.createCall({ direction: "outbound", from: "+4930555000401", to: "+4915112340011", goal: "Test", tenantId: MANDANT });
  await store.persistCall(call.id);
  const marker = speicher.makePostgresAnrufstartMarker(runner);

  assert.equal(await marker.lies(call.id), null);
  assert.equal(await marker.setze({ callId: call.id, tenantId: MANDANT, jetztIso: ERSTER_ZEITPUNKT }), true);
  assert.equal(await marker.setze({ callId: call.id, tenantId: MANDANT, jetztIso: ZWEITER_ZEITPUNKT }), false);
  assert.equal(await marker.lies(call.id), ERSTER_ZEITPUNKT);
  assert.equal(await marker.lies("call-ohne-marker"), null);

  const { rows } = await db.query("SELECT call_id, tenant_id FROM anrufstart_marker");
  assert.deepEqual(rows, [{ call_id: call.id, tenant_id: MANDANT }]);
});

test("Anrufstart-Marker (Speicher): der erste Eintrag gilt, jeder weitere meldet false", async () => {
  const marker = speicher.makeAnrufstartMarker();
  assert.equal(await marker.lies("c1"), null);
  assert.equal(await marker.setze({ callId: "c1", tenantId: MANDANT, jetztIso: ERSTER_ZEITPUNKT }), true);
  assert.equal(await marker.setze({ callId: "c1", tenantId: MANDANT, jetztIso: ZWEITER_ZEITPUNKT }), false);
  assert.equal(await marker.lies("c1"), ERSTER_ZEITPUNKT);
  assert.equal(await marker.lies("c2"), null);
});
