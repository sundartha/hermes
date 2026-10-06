import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
import { PRICES, tokensOf } from "./_prices.js";

const OTHER = "other";

async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

async function setup() {
  const db = new PGlite();
  const store = await reopen(db);
  await db.query(`INSERT INTO tenant (id) VALUES ($1) ON CONFLICT DO NOTHING`, [OTHER]);
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
     VALUES ('call_other', $1, 'tok', 'inbound', 'active', now()::text)`,
    [OTHER],
  );
  await db.query(
    `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at)
     VALUES ('call_other', $1, 'caller', 'GEHEIM fremder Tenant', now()::text)`,
    [OTHER],
  );
  await db.query(
    `INSERT INTO action_item (id, tenant_id, call_id, text, type, done, created_at)
     VALUES ('ai_other', $1, 'call_other', 'Fremd-Item', 'todo', false, now()::text)`,
    [OTHER],
  );
  await db.query(
    `INSERT INTO notification (id, tenant_id, title, body, call_id, at)
     VALUES ('nt_other', $1, 'Fremd', '', 'call_other', now()::text)`,
    [OTHER],
  );
  return { store, db };
}

const countWhereTenant = async (db, table, tenantId) =>
  Number(
    (await db.query(`SELECT count(*) AS n FROM ${table} WHERE tenant_id=$1`, [tenantId])).rows[0].n,
  );

test("F8-Interaktion: eraseTenantData loescht auch den EIGENEN, noch aktiven Call", async () => {
  const { store, db } = await setup();
  const active = store.createCall({
    direction: "inbound",
    from: "+49",
    to: "+49",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  store.addTranscript(active.id, "caller", "Owner-Geheim-noch-aktiv");
  await store.save();
  assert.equal(
    (await db.query(`SELECT status FROM call WHERE id=$1`, [active.id])).rows[0].status,
    "active",
    "Vorbedingung: Call ist beim Erase noch aktiv",
  );

  store.eraseTenantData(BOOTSTRAP_TENANT_ID);
  await store.save();

  assert.equal(await countWhereTenant(db, "call", BOOTSTRAP_TENANT_ID), 0, "aktiver Call weg");
  assert.equal(
    await countWhereTenant(db, "transcript_segment", BOOTSTRAP_TENANT_ID),
    0,
    "Transkript per CASCADE weg",
  );
});

test("R3-Kern: eraseTenantData(owner) loescht alle Owner-Zeilen; fremder Tenant bleibt unberuehrt", async () => {
  const { store, db } = await setup();
  const c = store.createCall({ direction: "outbound", from: "+49", to: "+49", goal: "Owner", tenantId: BOOTSTRAP_TENANT_ID });
  store.addTranscript(c.id, "agent", "Hallo Owner");
  store.addTranscript(c.id, "caller", "Owner-Geheim");
  store.addActionItem(c.id, "Owner-Rueckruf");
  store.addNotification("Owner-Notif", "", c.id);
  await store.save();

  store.eraseTenantData(BOOTSTRAP_TENANT_ID);
  await store.save();

  assert.equal(await countWhereTenant(db, "call", BOOTSTRAP_TENANT_ID), 0, "Owner-Calls weg");
  assert.equal(
    await countWhereTenant(db, "transcript_segment", BOOTSTRAP_TENANT_ID),
    0,
    "Owner-Transkripte weg (CASCADE)",
  );
  assert.equal(
    await countWhereTenant(db, "action_item", BOOTSTRAP_TENANT_ID),
    0,
    "Owner-Action-Items weg",
  );
  assert.equal(
    await countWhereTenant(db, "notification", BOOTSTRAP_TENANT_ID),
    0,
    "Owner-Notifications weg",
  );

  assert.equal(await countWhereTenant(db, "call", OTHER), 1, "fremder Call bleibt");
  assert.equal(
    await countWhereTenant(db, "transcript_segment", OTHER),
    1,
    "fremdes Transkript bleibt",
  );
  assert.equal(await countWhereTenant(db, "action_item", OTHER), 1, "fremdes Action Item bleibt");
  assert.equal(await countWhereTenant(db, "notification", OTHER), 1, "fremde Notification bleibt");
  const text = (await db.query(`SELECT text FROM transcript_segment WHERE tenant_id=$1`, [OTHER]))
    .rows[0].text;
  assert.equal(text, "GEHEIM fremder Tenant", "fremder Transkript-Text intakt");
});

test("Atomaritaet (P16/G26): Flush-Fehler nach dem Hard-Delete rollt auch den Hard-Delete zurueck", async () => {
  const db = new PGlite();
  let failNextTenantInsert = false;
  const runner = {
    withClient: (fn) =>
      fn({
        query: (text, params) => {
          if (failNextTenantInsert && text.startsWith("INSERT INTO tenant")) {
            throw new Error("simulierter Flush-Fehler (Test)");
          }
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
  const store = makePgStore(runner);
  await store.init();

  const c = store.createCall({
    direction: "outbound",
    from: "+49",
    to: "+49",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  store.addTranscript(c.id, "agent", "bleibt-bei-rollback");
  await store.save();

  failNextTenantInsert = true;
  store.eraseTenantData(BOOTSTRAP_TENANT_ID);
  await store.save();
  failNextTenantInsert = false;

  assert.equal(
    Number((await db.query(`SELECT count(*) AS n FROM call WHERE id=$1`, [c.id])).rows[0].n),
    1,
    "Call ueberlebt den fehlgeschlagenen Flush - Hard-Delete wurde mit zurueckgerollt",
  );
  assert.equal(
    Number(
      (await db.query(`SELECT count(*) AS n FROM transcript_segment WHERE call_id=$1`, [c.id]))
        .rows[0].n,
    ),
    1,
    "Transkript-Segment ueberlebt ebenfalls (keine Teil-Loeschung)",
  );
});

test("Re-Hydrierung nach Erase: Owner-Calls leer, settings/usage/calendar ueberleben", async () => {
  const { store, db } = await setup();
  store.updateSettings(BOOTSTRAP_TENANT_ID, { agentName: "Owner-Service" });
  store.trackUsage(BOOTSTRAP_TENANT_ID, tokensOf(1_000_000, 0), PRICES);
  const c = store.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  store.addTranscript(c.id, "agent", "weg");
  await store.save();

  store.eraseTenantData(BOOTSTRAP_TENANT_ID);
  await store.save();

  const reopened = await reopen(db);
  assert.equal(
    reopened.load().calls.filter((c) => c.tenantId === BOOTSTRAP_TENANT_ID).length,
    0,
    "Owner-Calls weg nach Re-Hydrierung",
  );
  assert.equal(
    reopened.load().settings[BOOTSTRAP_TENANT_ID].agentName,
    "Owner-Service",
    "settings ueberleben",
  );
  assert.equal(
    reopened.load().usage[BOOTSTRAP_TENANT_ID].inputTokens,
    1_000_000,
    "usage/Budget-Gate ueberlebt",
  );
  assert.equal(
    reopened.getCalendar(BOOTSTRAP_TENANT_ID).length,
    3,
    "Demo-Kalender (Service-Config) bleibt",
  );
});
