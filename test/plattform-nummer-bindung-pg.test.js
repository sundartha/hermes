import { test } from "node:test";
import assert from "node:assert/strict";
import { neuePglite } from "./pglite-helfer.js";
import { applySchema } from "../src/db/migrate.js";
import { makePgStore } from "../src/store/pg.js";
import { NUMBER_STATUS, PROVIDER, PLATFORM_NUMBER_PURPOSE } from "../src/store/defaults.js";
import * as ops from "../src/store/state-ops.js";
import { makePgTestStore } from "./pg-helpers.js";

const CUSTOMER_DID = "+4915112345678";
const ANI = "+15005550006";
const ANI_SCHLUESSEL = { e164: ANI, purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI };

function bindeAni(state) {
  ops.bindPlatformNumber(state, { ...ANI_SCHLUESSEL, provider: PROVIDER.TELNYX, tenantId: null });
}

async function speichereGebundeneAktiveNummer(store, { id, tenantId }) {
  const state = store.load();
  ops.registerTenant(state, tenantId);
  state.numbers.push({
    id,
    tenantId,
    e164: CUSTOMER_DID,
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: `ext_${id}`,
  });
  ops.bindPlatformNumber(state, { e164: CUSTOMER_DID, purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI, provider: PROVIDER.TELNYX, tenantId: null });
  await store.save();
}

async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

test("P1: NEUSTART-Round-Trip - binden, save(), Spiegel verwerfen, neu hydrieren, lesen", async () => {
  const { store, db } = await makePgTestStore();
  const state = store.load();
  ops.registerTenant(state, "t1");
  ops.bindPlatformNumber(state, {
    e164: ANI,
    purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI,
    provider: PROVIDER.TELNYX,
    tenantId: null,
    note: "test",
  });
  await store.save();

  const reopened = await reopen(db);
  const [binding] = ops.platformNumberBindings(reopened.load(), ANI);
  assert.ok(binding, "Bindung ueberlebt Neustart");
  assert.equal(binding.purpose, PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI);
  assert.equal(binding.tenantId, null);
  assert.ok(binding.boundAt, "boundAt ist gesetzt");
  assert.equal(binding.releasedAt, null);
});

test("P2: Ebene C wirft am Store vorbei - rohes UPDATE auf gebundene Zeile", async () => {
  const { store, db } = await makePgTestStore();
  await speichereGebundeneAktiveNummer(store, { id: "n1", tenantId: "t1" });

  await assert.rejects(
    () => db.query(`UPDATE number SET status='released' WHERE id='n1'`),
    (err) => {
      assert.equal(err.code, "P0001");
      return true;
    },
  );
  const numberRow = (await db.query(`SELECT status FROM number WHERE id='n1'`)).rows[0];
  assert.equal(numberRow.status, "active");
});

test("P3 (Positiv-Kontrolle): dasselbe rohe UPDATE auf eine UNGEBUNDENE Zeile geht durch", async () => {
  const { store, db } = await makePgTestStore();
  const state = store.load();
  ops.registerTenant(state, "t1");
  state.numbers.push({
    id: "n2",
    tenantId: "t1",
    e164: CUSTOMER_DID,
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: "ext_n2",
  });
  await store.save();

  await db.query(`UPDATE number SET status='released' WHERE id='n2'`);
  const numberRow = (await db.query(`SELECT status FROM number WHERE id='n2'`)).rows[0];
  assert.equal(numberRow.status, "released");
});

test("P4 (Flush-Regression, PM-11): gebundene, BEREITS released-e Zeile zweimal flushen -> kein Wurf", async () => {
  const { store } = await makePgTestStore();
  const state = store.load();
  ops.registerTenant(state, "t1");
  state.numbers.push({
    id: "n3",
    tenantId: "t1",
    e164: CUSTOMER_DID,
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.RELEASED,
    providerNumberId: "ext_n3",
  });
  ops.bindPlatformNumber(state, { e164: CUSTOMER_DID, purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI, provider: PROVIDER.TELNYX, tenantId: null });
  const zweiFlushes = async () => {
    await store.save();
    await store.save();
    await store.drainFlushes();
  };
  await assert.doesNotReject(zweiFlushes);
});

test("P5 (Prune-Regression, PM-12): Flush mit leerem Nummern-Slice des gebundenen Tenants -> kein Wurf, Bindung ueberlebt", async () => {
  const { store, db } = await makePgTestStore();
  const state = store.load();
  ops.registerTenant(state, "t1");
  state.numbers.push({
    id: "n4",
    tenantId: "t1",
    e164: CUSTOMER_DID,
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: "ext_n4",
  });
  ops.bindPlatformNumber(state, { e164: CUSTOMER_DID, purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI, provider: PROVIDER.TELNYX, tenantId: null });
  await store.save();

  state.numbers = state.numbers.filter((number) => number.id !== "n4");
  await store.save();

  const remaining = (await db.query(`SELECT id FROM number WHERE id='n4'`)).rows;
  assert.equal(remaining.length, 0, "die Zeile wurde geprunt (DELETE, kein Trigger-Wurf)");
  const [binding] = ops.platformNumberBindings(store.load(), CUSTOMER_DID);
  assert.ok(binding, "die Bindung ueberlebt den Prune (eigene, globale Tabelle)");
});

test("P6 (Flush-Reihenfolge): Unbind + releaseNumber in EINEM save() - die legitime Kuendigung wirft NICHT", async () => {
  const { store, db } = await makePgTestStore();
  const state = store.load();
  ops.registerTenant(state, "t1");
  state.numbers.push({
    id: "n5",
    tenantId: "t1",
    e164: CUSTOMER_DID,
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: "ext_n5",
  });
  ops.bindPlatformNumber(state, {
    e164: CUSTOMER_DID,
    purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI,
    provider: PROVIDER.TELNYX,
    tenantId: "t1",
  });
  await store.save();

  const fresh = store.load();
  const number = ops.findNumber(fresh, "n5");
  ops.unbindPlatformNumber(fresh, { e164: number.e164, purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI });
  ops.releaseNumber(fresh, "n5");
  await store.save();

  const numberRow = (await db.query(`SELECT status, e164 FROM number WHERE id='n5'`)).rows[0];
  assert.equal(numberRow.status, "released");
  assert.equal(numberRow.e164, null);
  const bindingRow = (
    await db.query(`SELECT released_at FROM platform_number_use WHERE e164=$1`, [CUSTOMER_DID])
  ).rows[0];
  assert.ok(bindingRow.released_at, "die Bindung ist geschlossen");
});

test("P7: Teilindex - zweite offene Bindung fuer (e164, purpose) wird abgewiesen; nach Unbind wieder erlaubt", async () => {
  const { store, db } = await makePgTestStore();
  bindeAni(store.load());
  await store.save();

  await assert.rejects(() =>
    db.query(
      `INSERT INTO platform_number_use (id, e164, purpose, provider) VALUES ('pnu_dup', $1, $2, 'telnyx')`,
      [ANI, PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI],
    ),
  );

  const fresh = store.load();
  ops.unbindPlatformNumber(fresh, ANI_SCHLUESSEL);
  bindeAni(fresh);
  await store.save();

  const openRows = (
    await db.query(`SELECT id FROM platform_number_use WHERE e164=$1 AND released_at IS NULL`, [ANI])
  ).rows;
  assert.equal(openRows.length, 1, "genau eine offene Bindung nach Unbind+Rebind");
});

test("P8: Schema-Idempotenz mit Trigger - applySchema zweimal auf frischer PGlite wirft nicht", async () => {
  const db = await neuePglite();
  const conn = { query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) };
  await applySchema(conn);
  await applySchema(conn);
  assert.ok(true, "zweiter applySchema-Aufruf mit der neuen Trigger-DDL wirft nicht");
});

test("P9: Bindungstabelle ist global lesbar - RLS ENABLE+FORCE, nur die globale Policy, auch nach einer alten tenant_isolation-Policy", async () => {
  const db = await neuePglite();
  const conn = { query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) };
  await applySchema(conn);
  await db.exec(`CREATE POLICY tenant_isolation ON platform_number_use USING (false)`);
  await applySchema(conn);
  const [table] = (
    await db.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'platform_number_use'`,
    )
  ).rows;
  assert.deepEqual(table, { relrowsecurity: true, relforcerowsecurity: true });
  const policies = (
    await db.query(
      `SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'platform_number_use'`,
    )
  ).rows;
  assert.deepEqual(policies, [
    { policyname: "platform_number_use_global", cmd: "ALL", qual: "true", with_check: "true" },
  ]);
});

test("P10: Teilindex - nach Unbind und Rebind stehen die freigegebene und die neue Bindung beide in der Datenbank", async () => {
  const { store, db } = await makePgTestStore();
  bindeAni(store.load());
  await store.save();
  ops.unbindPlatformNumber(store.load(), ANI_SCHLUESSEL);
  await store.save();
  bindeAni(store.load());
  await store.save();

  const { rows } = await db.query(`SELECT released_at IS NULL AS open FROM platform_number_use WHERE e164=$1`, [ANI]);
  assert.deepEqual(rows.map((row) => row.open).sort(), [false, true], "eine freigegebene und eine offene Bindung");
});

test("P11: Sperren (suspended) einer gebundenen Nummer wirft ebenfalls, die Zeile bleibt aktiv", async () => {
  const { store, db } = await makePgTestStore();
  const number = { id: "n11", tenantId: "t11" };
  await speichereGebundeneAktiveNummer(store, number);

  const err = await db.query(`UPDATE number SET status='suspended' WHERE id=$1`, [number.id]).catch((e) => e);
  assert.equal(err.code, "P0001", "der Trigger wirft");
  const { rows } = await db.query(`SELECT status FROM number WHERE id=$1`, [number.id]);
  assert.deepEqual(rows, [{ status: NUMBER_STATUS.ACTIVE }]);
});

test("P12: Teilindex je Rolle - dieselbe Nummer als Absender-ANI und SMS-Absender ergibt zwei offene Bindungen", async () => {
  const { store, db } = await makePgTestStore();
  const purposes = Object.values(PLATFORM_NUMBER_PURPOSE);
  const state = store.load();
  for (const purpose of purposes) {
    ops.bindPlatformNumber(state, { e164: ANI, purpose, provider: PROVIDER.TELNYX, tenantId: null, note: purpose });
  }
  await store.save();

  const open = await db.query(`SELECT purpose FROM platform_number_use WHERE released_at IS NULL AND e164=$1`, [ANI]);
  assert.deepEqual(open.rows.map((row) => row.purpose).sort(), [...purposes].sort());
});

test("P13: eine gesperrte, gebundene Nummer laesst sich wieder aktivieren - nur Freigabe und Sperre sind gesperrt", async () => {
  const { store, db } = await makePgTestStore();
  const state = store.load();
  const suspended = { id: "n13", tenantId: "t13", e164: CUSTOMER_DID, status: NUMBER_STATUS.SUSPENDED };
  ops.registerTenant(state, suspended.tenantId);
  state.numbers.push({ ...suspended, provider: PROVIDER.TELNYX, providerNumberId: "ext_n13" });
  ops.bindPlatformNumber(state, { e164: CUSTOMER_DID, purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER, provider: PROVIDER.TELNYX, tenantId: null });
  await store.save();

  await db.query(`UPDATE number SET status=$2 WHERE id=$1`, [suspended.id, NUMBER_STATUS.ACTIVE]);
  const after = await db.query(`SELECT status FROM number WHERE id=$1`, [suspended.id]);
  assert.equal(after.rows[0].status, NUMBER_STATUS.ACTIVE);
});
