import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { config } from "../src/config.js";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
import * as ops from "../src/store/state-ops.js";

const OWNER_SUB = "owner-sub-1";

const runnerFor = (db) => ({
  withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
});

async function withOwnerIdpSubject(value, fn) {
  const saved = config.auth.ownerIdpSubject;
  config.auth.ownerIdpSubject = value;
  try {
    return await fn();
  } finally {
    config.auth.ownerIdpSubject = saved;
  }
}

async function dbIdpSubject(db) {
  const rows = (
    await db.query(`SELECT idp_subject FROM tenant WHERE id = $1`, [BOOTSTRAP_TENANT_ID])
  ).rows;
  return rows[0]?.idp_subject ?? null;
}

test("AM6 pg: init() bindet OWNER_IDP_SUBJECT, persistiert + resolveTenant trifft Bootstrap", async () => {
  const db = new PGlite();
  await withOwnerIdpSubject(OWNER_SUB, async () => {
    const store = makePgStore(runnerFor(db));
    await store.init();
    assert.equal(store.resolveTenant(OWNER_SUB), BOOTSTRAP_TENANT_ID, "in-memory aufloesbar");
    assert.equal(await dbIdpSubject(db), OWNER_SUB, "idp_subject in der DB persistiert");

    const reopened = makePgStore(runnerFor(db));
    await reopened.init();
    assert.equal(reopened.resolveTenant(OWNER_SUB), BOOTSTRAP_TENANT_ID, "persistiert re-hydriert");
    assert.equal(
      ops.seedBootstrapIdpSubject(reopened.load(), OWNER_SUB, BOOTSTRAP_TENANT_ID),
      false,
      "zweiter Lauf = No-Op (idempotent)",
    );
  });
});

test("AM6 pg: leeres OWNER_IDP_SUBJECT -> kein idp_subject-Seed (byte-identisch)", async () => {
  const db = new PGlite();
  await withOwnerIdpSubject("", async () => {
    const store = makePgStore(runnerFor(db));
    await store.init();
    assert.equal(await dbIdpSubject(db), null, "kein Seed -> idp_subject bleibt NULL");
    assert.equal(store.resolveTenant("irgendwas"), null, "ohne Bindung loest nichts auf");
  });
});

test("AM6 unit seedBootstrapIdpSubject: fehlender Owner / schon gebunden / leer / frisch", () => {
  assert.equal(
    ops.seedBootstrapIdpSubject({ tenants: [] }, OWNER_SUB, BOOTSTRAP_TENANT_ID),
    false,
    "fehlender Owner -> false",
  );

  const bound = { tenants: [{ id: BOOTSTRAP_TENANT_ID, idpSubject: "alt" }] };
  assert.equal(ops.seedBootstrapIdpSubject(bound, "neu", BOOTSTRAP_TENANT_ID), false);
  assert.equal(bound.tenants[0].idpSubject, "alt", "bestehende Bindung unveraendert");

  const fresh = { tenants: [{ id: BOOTSTRAP_TENANT_ID }] };
  assert.equal(ops.seedBootstrapIdpSubject(fresh, "   ", BOOTSTRAP_TENANT_ID), false);
  assert.equal(ops.seedBootstrapIdpSubject(fresh, undefined, BOOTSTRAP_TENANT_ID), false);
  assert.ok(!fresh.tenants[0].idpSubject, "leerer/fehlender Wert bindet nicht");

  assert.equal(ops.seedBootstrapIdpSubject(fresh, "  owner-sub-1  ", BOOTSTRAP_TENANT_ID), true);
  assert.equal(fresh.tenants[0].idpSubject, "owner-sub-1", "getrimmt gebunden");
});
