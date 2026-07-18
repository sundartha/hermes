// AM6 G4-a: OWNER_IDP_SUBJECT bindet den Owner-sub idempotent an den Bootstrap-Tenant -
// LIVE ist pg, darum MUSS der Seed in pg.init() greifen (anders als OWNER_NUMBER_SEED,
// json-only). Gegen pglite (Postgres-in-WASM, offline, F.I.R.S.T.). REIN pglite, NIE mit
// Server-Spawn in derselben Datei (P6a-Stall-Lehre).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { config } from "../src/config.js";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
import * as ops from "../src/store/state-ops.js";

const OWNER_SUB = "owner-sub-1";

// pglite ist ein-verbindig: withClient reicht die Instanz als Client durch.
const runnerFor = (db) => ({
  withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
});

// config.auth.ownerIdpSubject fuer die Dauer von fn() setzen + exakt restaurieren (Muster
// withConfig aus config-payment-guard.test.js; Test-Isolation, kein Spawn/keine Env).
async function withOwnerIdpSubject(value, fn) {
  const saved = config.auth.ownerIdpSubject;
  config.auth.ownerIdpSubject = value;
  try {
    return await fn();
  } finally {
    config.auth.ownerIdpSubject = saved;
  }
}

// idp_subject des Bootstrap-Tenants direkt aus der DB (Persistenz-Beweis; tenant-Tabelle
// hat keine RLS -> kein GUC noetig).
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

    // Re-Hydrierung aus der DB (zweiter Store) -> die Bindung ueberlebt; ein zweiter Lauf
    // ist No-Op (set-if-absent sieht die gebundene Identitaet -> kein erneuter Flush).
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
  // fehlender Owner-Tenant -> false (kein Throw)
  assert.equal(
    ops.seedBootstrapIdpSubject({ tenants: [] }, OWNER_SUB, BOOTSTRAP_TENANT_ID),
    false,
    "fehlender Owner -> false",
  );

  // schon gebunden -> false (set-if-absent, bestehende Bindung gewinnt + unangetastet)
  const bound = { tenants: [{ id: BOOTSTRAP_TENANT_ID, idpSubject: "alt" }] };
  assert.equal(ops.seedBootstrapIdpSubject(bound, "neu", BOOTSTRAP_TENANT_ID), false);
  assert.equal(bound.tenants[0].idpSubject, "alt", "bestehende Bindung unveraendert");

  // leer / nur-Whitespace / fehlend -> false (fail-closed), keine Mutation
  const fresh = { tenants: [{ id: BOOTSTRAP_TENANT_ID }] };
  assert.equal(ops.seedBootstrapIdpSubject(fresh, "   ", BOOTSTRAP_TENANT_ID), false);
  assert.equal(ops.seedBootstrapIdpSubject(fresh, undefined, BOOTSTRAP_TENANT_ID), false);
  assert.ok(!fresh.tenants[0].idpSubject, "leerer/fehlender Wert bindet nicht");

  // frischer Owner + nicht-leerer (getrimmter) sub -> true + mutiert
  assert.equal(ops.seedBootstrapIdpSubject(fresh, "  owner-sub-1  ", BOOTSTRAP_TENANT_ID), true);
  assert.equal(fresh.tenants[0].idpSubject, "owner-sub-1", "getrimmt gebunden");
});
