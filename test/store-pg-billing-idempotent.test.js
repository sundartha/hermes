import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
import { makeDefaultState, createCall, markBilled } from "../src/store/state-ops.js";

async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

const outboundCall = () => ({
  direction: "outbound",
  from: "+491700000000",
  to: "+491701111111",
  tenantId: BOOTSTRAP_TENANT_ID,
});

test("markBilled ist idempotent: gesetzter Marker gewinnt, kein zweites Schreiben", () => {
  const s = makeDefaultState();
  const c = createCall(s, outboundCall());
  assert.equal(c.billedAt, null, "frischer Call ist ungebucht");

  const first = markBilled(s, c.id);
  assert.equal(first.changed, true, "erstes Buchen aendert den Record");
  const stamp = first.call.billedAt;
  assert.ok(
    typeof stamp === "string" && !Number.isNaN(Date.parse(stamp)),
    "Marker ist eine ISO-Zeit",
  );

  const second = markBilled(s, c.id);
  assert.equal(second.changed, false, "zweites Buchen ist ein No-op (kein Wrapper-save)");
  assert.equal(second.call.billedAt, stamp, "Zeitstempel unveraendert (gesetzter gewinnt)");
});

test("markBilled fuer unbekannten Call: changed=false, kein Throw", () => {
  const s = makeDefaultState();
  const res = markBilled(s, "call_does_not_exist");
  assert.equal(res.changed, false);
  assert.equal(res.call, null);
});

test("billedAt round-trippt durch flush/hydrate (pg): ueberlebt den Restart", async () => {
  const db = new PGlite();
  const store = await reopen(db);
  const c = store.createCall(outboundCall());
  assert.equal(store.getCall(c.id).billedAt, null, "frischer Call ist ungebucht");

  store.markBilled(c.id);
  await store.save();

  const reopened = await reopen(db);
  const billedAt = reopened.getCall(c.id).billedAt;
  assert.ok(
    typeof billedAt === "string" && !Number.isNaN(Date.parse(billedAt)),
    "Bucht-Marker ist eine persistierte ISO-Zeit",
  );
});
