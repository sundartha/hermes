// P8b: Per-Tenant-DSGVO-Loeschung gegen pglite (Postgres-in-WASM, offline). Nagelt
// die Pre-Mortem-R3-Invariante fest: eraseTenantData(owner) reisst NUR Owner-Zeilen
// raus (call/transcript_segment/action_item/notification), ein direkt geseedeter
// FREMDER Tenant bleibt VOLLSTAENDIG erhalten (Cross-Tenant-Dichtheit, direkt in der
// DB als Superuser geprueft). Plus Re-Hydrierung: settings/usage/calendar des Owners
// ueberleben (Service/Identitaet/Budget-Gate). pglite = kein Netz (F.I.R.S.T.).
//
// ISOLATION: pglite UND Server-Spawn NIE in einer Datei (P3/P6a-Lehre) - hier nur pglite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, OWNER_TENANT_ID } from "../src/store/pg.js";

const OTHER = "other";
const PRICES = { priceInPerMTokUsd: 1.0, priceOutPerMTokUsd: 5.0, usdToEur: 0.93, maxBudgetEur: 8 };

// Baut auf einer BESTEHENDEN pglite-Instanz einen frischen Store (re-hydriert den
// Spiegel aus der DB), um Persistenz statt nur In-Memory zu pruefen.
async function reopen(db) {
  const runner = { withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }) };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

// Owner-Store + ein direkt in die DB geseedeter FREMDER Tenant mit eigenen Call-/
// Transkript-/Action-Item-/Notification-Zeilen (als Superuser, umgeht RLS - genau so
// kann der Test die Cross-Tenant-Invariante VOLLSTAENDIG sehen).
async function setup() {
  const db = new PGlite();
  const store = await reopen(db);
  await db.query(`INSERT INTO tenant (id) VALUES ($1) ON CONFLICT DO NOTHING`, [OTHER]);
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
     VALUES ('call_other', $1, 'tok', 'inbound', 'active', now()::text)`,
    [OTHER]
  );
  await db.query(
    `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at)
     VALUES ('call_other', $1, 'caller', 'GEHEIM fremder Tenant', now()::text)`,
    [OTHER]
  );
  await db.query(
    `INSERT INTO action_item (id, tenant_id, call_id, text, type, done, created_at)
     VALUES ('ai_other', $1, 'call_other', 'Fremd-Item', 'todo', false, now()::text)`,
    [OTHER]
  );
  await db.query(
    `INSERT INTO notification (id, tenant_id, title, body, call_id, at)
     VALUES ('nt_other', $1, 'Fremd', '', 'call_other', now()::text)`,
    [OTHER]
  );
  return { store, db };
}

const countWhereTenant = async (db, table, tenantId) =>
  Number((await db.query(`SELECT count(*) AS n FROM ${table} WHERE tenant_id=$1`, [tenantId])).rows[0].n);

test("R3-Kern: eraseTenantData(owner) loescht alle Owner-Zeilen; fremder Tenant bleibt unberuehrt", async () => {
  const { store, db } = await setup();
  // Owner-Call-Satz ueber die Store-API anlegen (call + Transkript + Action Item + Notification).
  const c = store.createCall({ direction: "outbound", from: "+49", to: "+49", goal: "Owner" });
  store.addTranscript(c.id, "agent", "Hallo Owner");
  store.addTranscript(c.id, "caller", "Owner-Geheim");
  store.addActionItem(c.id, "Owner-Rueckruf");
  store.addNotification("Owner-Notif", "", c.id);
  await store.save();

  store.eraseTenantData(OWNER_TENANT_ID);
  await store.save();

  // Direkt in der DB (Superuser sieht alles): Owner-Zeilen = 0 in allen 4 Tabellen.
  assert.equal(await countWhereTenant(db, "call", OWNER_TENANT_ID), 0, "Owner-Calls weg");
  assert.equal(await countWhereTenant(db, "transcript_segment", OWNER_TENANT_ID), 0, "Owner-Transkripte weg (CASCADE)");
  assert.equal(await countWhereTenant(db, "action_item", OWNER_TENANT_ID), 0, "Owner-Action-Items weg");
  assert.equal(await countWhereTenant(db, "notification", OWNER_TENANT_ID), 0, "Owner-Notifications weg");

  // Fremder Tenant VOLLSTAENDIG erhalten (Cross-Tenant-Invariante).
  assert.equal(await countWhereTenant(db, "call", OTHER), 1, "fremder Call bleibt");
  assert.equal(await countWhereTenant(db, "transcript_segment", OTHER), 1, "fremdes Transkript bleibt");
  assert.equal(await countWhereTenant(db, "action_item", OTHER), 1, "fremdes Action Item bleibt");
  assert.equal(await countWhereTenant(db, "notification", OTHER), 1, "fremde Notification bleibt");
  const text = (await db.query(`SELECT text FROM transcript_segment WHERE tenant_id=$1`, [OTHER])).rows[0].text;
  assert.equal(text, "GEHEIM fremder Tenant", "fremder Transkript-Text intakt");
});

test("Re-Hydrierung nach Erase: Owner-Calls leer, settings/usage/calendar ueberleben", async () => {
  const { store, db } = await setup();
  // Service/Identitaet/Budget-Gate vorab setzen, damit ihr Ueberleben pruefbar ist.
  store.updateSettings(OWNER_TENANT_ID, { agentName: "Owner-Service" });
  store.trackUsage(OWNER_TENANT_ID, 1_000_000, 0, PRICES);
  const c = store.createCall({ direction: "outbound", from: "+49", to: "+49" });
  store.addTranscript(c.id, "agent", "weg");
  await store.save();

  store.eraseTenantData(OWNER_TENANT_ID);
  await store.save();

  const reopened = await reopen(db);
  // OWNER-Calls weg nach Re-Hydrierung. Seit I8 hydriert der Store multi-tenant
  // (ueber s.tenants), d.h. der direkt geseedete FREMDE Tenant 'other' round-trippt
  // jetzt seinen Call mit - die Cross-Tenant-Erhaltung bleibt also auch nach der
  // Re-Hydrierung sichtbar. Darum hier OWNER-scoped zaehlen statt blind alle Calls.
  assert.equal(
    reopened.load().calls.filter((c) => c.tenantId === OWNER_TENANT_ID).length, 0,
    "Owner-Calls weg nach Re-Hydrierung"
  );
  assert.equal(reopened.load().settings[OWNER_TENANT_ID].agentName, "Owner-Service", "settings ueberleben");
  assert.equal(reopened.load().usage[OWNER_TENANT_ID].inputTokens, 1_000_000, "usage/Budget-Gate ueberlebt");
  assert.equal(reopened.getCalendar(OWNER_TENANT_ID).length, 3, "Demo-Kalender (Service-Config) bleibt");
});
