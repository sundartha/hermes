import test from "node:test";
import assert from "node:assert/strict";
import { makePgStore } from "../src/store/pg.js";
import * as ops from "../src/store/state-ops.js";
import { makePgTestStore, BOOTSTRAP_TENANT_ID } from "./pg-helpers.js";
import { PROVIDER_COST_RECORD_WINDOW_MS } from "../src/billing/cost-truing.js";
import {
  REVIEWER_SEED_CALLS,
  applyReviewerSeed,
  applyReviewerSeedAndPersist,
  reviewerSeedEndedAtIso,
} from "../scripts/lib/reviewer-demo-seed.mjs";
import {
  expectedSchemaColumns,
  openPgStoreWithoutMigration,
  readSchemaColumns,
  schemaDifferences,
} from "../scripts/lib/pg-schema-abgleich.mjs";

const REVIEWER_TENANT = "tenant_reviewer_pg";
const SEED_CALL_COUNT = REVIEWER_SEED_CALLS.length;
const SEED_ITEM_COUNT = REVIEWER_SEED_CALLS.flatMap((entry) => entry.actionItems).length;
const SEED_SUMMARIES = new Set(REVIEWER_SEED_CALLS.map((entry) => entry.summary));
const HEARTBEAT_AUS_H = 0;
const ENDED_AT = reviewerSeedEndedAtIso({
  nowMs: Date.now(),
  belegFensterMs: PROVIDER_COST_RECORD_WINDOW_MS,
  heartbeatFensterH: HEARTBEAT_AUS_H,
});

const tenantRow = (store) =>
  structuredClone(store.load().tenants.find((tenant) => tenant.id === REVIEWER_TENANT));

async function seededStore() {
  const { store, runner, db } = await makePgTestStore();
  const state = store.load();
  ops.registerTenant(state, REVIEWER_TENANT, {
    firstName: "Reviewer",
    idpSubject: "reviewer-sub-pg",
  });
  ops.setKycLevel(state, REVIEWER_TENANT, "card");
  ops.setTenantSubscription(state, REVIEWER_TENANT, {
    subscriptionId: "sub_reviewer_pg",
    planSlug: "starter",
  });
  await store.save();
  return { store, runner, db };
}

async function reopen(runner) {
  const store = makePgStore(runner);
  await store.init();
  return store;
}

test("Reviewer-Seed pg: Zeilen ueberleben Flush + Neu-Hydrierung, Mandant unveraendert, idempotent", async () => {
  const { store, runner } = await seededStore();
  const rowBefore = tenantRow(store);

  assert.deepEqual(applyReviewerSeed(store, REVIEWER_TENANT, ENDED_AT), {
    callsCreated: SEED_CALL_COUNT,
    itemsCreated: SEED_ITEM_COUNT,
  });
  await store.save();

  const fresh = await reopen(runner);
  const { calls, actionItems } = fresh.exportTenantData(REVIEWER_TENANT);
  assert.equal(calls.length, SEED_CALL_COUNT);
  for (const call of calls) {
    assert.equal(call.direction, "inbound");
    assert.equal(call.status, "completed");
    assert.equal(call.answeredAt ?? null, null);
    assert.equal(call.endedAt, ENDED_AT, "vordatiertes endedAt ueberlebt den Flush");
    assert.ok(SEED_SUMMARIES.has(call.summary));
  }
  assert.equal(actionItems.filter((item) => !item.done).length, SEED_ITEM_COUNT);
  assert.deepEqual(tenantRow(fresh), rowBefore, "Mandanten-Zeile inkl. Abo/KYC unveraendert");

  assert.deepEqual(applyReviewerSeed(fresh, REVIEWER_TENANT, ENDED_AT), {
    callsCreated: 0,
    itemsCreated: 0,
  });
  assert.equal(
    fresh.exportTenantData(BOOTSTRAP_TENANT_ID).calls.length,
    0,
    "Betreiber ohne Seed-Zeilen",
  );
});

test("Reviewer-Seed pg: Betreiber-, unbekannter Mandant und fehlender Ende-Zeitpunkt werden verweigert, nichts geschrieben", async () => {
  const { store } = await seededStore();
  const callsBefore = store.load().calls.length;
  assert.throws(() => applyReviewerSeed(store, BOOTSTRAP_TENANT_ID, ENDED_AT), /Betreiber/);
  assert.throws(() => applyReviewerSeed(store, "tenant_unbekannt", ENDED_AT), /unbekannt/);
  assert.throws(() => applyReviewerSeed(store, "", ENDED_AT), /Mandanten-Kennung fehlt/);
  assert.throws(() => applyReviewerSeed(store, REVIEWER_TENANT), /Ende-Zeitpunkt/);
  assert.equal(store.load().calls.length, callsBefore);
});

const SEED_ROLE = "seed_role";
const DDL_ANWEISUNG = /^\s*(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMENT)\b/i;
const SCHEMA_SNAPSHOT_SQL = [
  `SELECT table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY 1, 2`,
  "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() ORDER BY 1",
  `SELECT tablename, policyname, qual, with_check FROM pg_policies
     WHERE schemaname = current_schema() ORDER BY 1, 2`,
  `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
     WHERE relnamespace = current_schema()::regnamespace AND relkind = 'r' ORDER BY 1`,
  "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1",
];
const DATA_SNAPSHOT_SQL = ["tenant", "call", "action_item", "settings", "usage"].map(
  (table) => `SELECT * FROM ${table} ORDER BY 1`,
);

const snapshot = (db, statements) =>
  Promise.all(statements.map(async (sql) => (await db.query(sql)).rows));

function recordingRunner(db) {
  const log = { exec: [], query: [] };
  const client = {
    query: (text, params) => {
      log.query.push(text);
      return db.query(text, params);
    },
    exec: (sql) => {
      log.exec.push(sql);
      return db.exec(sql);
    },
  };
  return { runner: { withClient: (fn) => fn(client) }, log };
}

const ddlStatements = (log) => [
  ...log.exec,
  ...log.query.filter((text) => DDL_ANWEISUNG.test(text)),
];

const EXPECTED_SCHEMA = await expectedSchemaColumns();

const SABOTAGE_FAELLE = [
  {
    name: "fehlende Spalte (Migration dieses Checkouts fehlt in der Zieldatenbank)",
    ddl: "ALTER TABLE call DROP COLUMN inbox_seen_at",
    meldung: /fehlt: call\.inbox_seen_at; unbekannt: -\)/,
  },
  {
    name: "fehlende Tabelle",
    ddl: "DROP TABLE calendar_event",
    meldung: /fehlt: calendar_event; unbekannt: -\)/,
  },
  {
    name: "unbekannte Spalte (Zieldatenbank aus einem neueren Stand)",
    ddl: "ALTER TABLE call ADD COLUMN spalte_aus_neuerem_stand TEXT",
    meldung: /fehlt: -; unbekannt: call\.spalte_aus_neuerem_stand\)/,
  },
];

test("Reviewer-Seed pg ohne Migration: Schema-Abweichung -> Abbruch, keine DDL, nichts geschrieben", async (ctx) => {
  for (const fall of SABOTAGE_FAELLE) {
    await ctx.test(fall.name, async () => {
      const { db } = await seededStore();
      await db.exec(fall.ddl);
      const schemaBefore = await snapshot(db, SCHEMA_SNAPSHOT_SQL);
      const dataBefore = await snapshot(db, DATA_SNAPSHOT_SQL);
      const { runner, log } = recordingRunner(db);

      await assert.rejects(openPgStoreWithoutMigration(runner, EXPECTED_SCHEMA), (err) => {
        assert.match(err.message, fall.meldung);
        assert.match(err.message, /keine DDL.*Nichts geschrieben/);
        return true;
      });
      assert.deepEqual(await snapshot(db, SCHEMA_SNAPSHOT_SQL), schemaBefore, "Schema gleich");
      assert.deepEqual(ddlStatements(log), [], "keine DDL ueber den Runner");
      assert.deepEqual(await snapshot(db, DATA_SNAPSHOT_SQL), dataBefore, "nichts geschrieben");
    });
  }
});

test("Reviewer-Seed pg: Positiv-Kontrolle - der Server-Boot (makePgStore ohne Optionen) migriert weiter", async () => {
  const { db } = await seededStore();
  await db.exec(SABOTAGE_FAELLE[0].ddl);
  const schemaBefore = await snapshot(db, SCHEMA_SNAPSHOT_SQL);
  const { runner, log } = recordingRunner(db);

  await makePgStore(runner).init();

  assert.notDeepEqual(
    await snapshot(db, SCHEMA_SNAPSHOT_SQL),
    schemaBefore,
    "Schnappschuss sieht DDL",
  );
  assert.ok(ddlStatements(log).length > 0, "Protokoll sieht DDL");
  assert.deepEqual(
    schemaDifferences(EXPECTED_SCHEMA, await readSchemaColumns(db)),
    { missing: [], unknown: [] },
    "Spalte wieder angelegt",
  );
});

async function restrictToSeedRole(db) {
  await db.exec(
    `CREATE ROLE ${SEED_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
     GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${SEED_ROLE};
     GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${SEED_ROLE};
     SET ROLE ${SEED_ROLE};`,
  );
}

async function openAsScript(db) {
  const { runner, log } = recordingRunner(db);
  return { store: await openPgStoreWithoutMigration(runner, EXPECTED_SCHEMA), log };
}

test("Reviewer-Seed pg ohne Migration: passendes Schema -> Seed ueber RLS, idempotent, keine DDL", async () => {
  const { db, store: bootStore } = await seededStore();
  const rowBefore = tenantRow(bootStore);
  const schemaBefore = await snapshot(db, SCHEMA_SNAPSHOT_SQL);
  await restrictToSeedRole(db);

  const first = await openAsScript(db);
  assert.deepEqual(await applyReviewerSeedAndPersist(first.store, REVIEWER_TENANT, ENDED_AT), {
    callsCreated: SEED_CALL_COUNT,
    itemsCreated: SEED_ITEM_COUNT,
  });
  const second = await openAsScript(db);
  const { calls } = second.store.exportTenantData(REVIEWER_TENANT);
  assert.equal(calls.length, SEED_CALL_COUNT, "Seed-Zeilen nach Neu-Hydrierung da");
  assert.deepEqual(
    tenantRow(second.store),
    rowBefore,
    "Mandanten-Zeile inkl. Abo/KYC unveraendert",
  );
  assert.deepEqual(await applyReviewerSeedAndPersist(second.store, REVIEWER_TENANT, ENDED_AT), {
    callsCreated: 0,
    itemsCreated: 0,
  });
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
  const visible = await db.query(`SELECT id FROM call WHERE tenant_id = $1`, [REVIEWER_TENANT]);
  assert.equal(visible.rows.length, 0, "RLS greift: unter fremder GUC unsichtbar");
  assert.deepEqual([...ddlStatements(first.log), ...ddlStatements(second.log)], []);
  await db.exec("RESET ROLE");
  assert.deepEqual(await snapshot(db, SCHEMA_SNAPSHOT_SQL), schemaBefore, "Schema gleich");
});

test("Reviewer-Seed pg: gescheiterter Flush endet als Fehler statt als 'angelegt'", async () => {
  const { db } = await seededStore();
  await db.exec(
    `CREATE FUNCTION seed_flush_sperre() RETURNS trigger AS $$
       BEGIN RAISE EXCEPTION 'Flush absichtlich gesperrt'; END $$ LANGUAGE plpgsql;
     CREATE TRIGGER seed_flush_sperre BEFORE INSERT ON call
       FOR EACH ROW EXECUTE FUNCTION seed_flush_sperre();`,
  );
  const { store } = await openAsScript(db);

  await assert.rejects(
    applyReviewerSeedAndPersist(store, REVIEWER_TENANT, ENDED_AT),
    /Flush absichtlich gesperrt/,
  );
  const rows = await db.query(`SELECT id FROM call WHERE tenant_id = $1`, [REVIEWER_TENANT]);
  assert.equal(rows.rows.length, 0, "Transaktion zurueckgerollt");
});

test("Reviewer-Seed pg: Schema-Vergleich - fehlend, unbekannt, fremde Tabellen bleiben aussen vor", () => {
  const expected = new Map([["call", new Set(["id", "summary"])]]);
  const actual = new Map([
    ["call", new Set(["id", "neu"])],
    ["fremde_tabelle", new Set(["x"])],
  ]);
  assert.deepEqual(schemaDifferences(expected, actual), {
    missing: ["call.summary"],
    unknown: ["call.neu"],
  });
  assert.deepEqual(schemaDifferences(expected, new Map()), { missing: ["call"], unknown: [] });
});
