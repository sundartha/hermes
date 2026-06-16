// I8: pg-Backend von OWNER_TENANT_ID entpinnt (multi-tenant hydrate/flush ueber
// s.tenants + additive tenant-Spalten owner_name/idp_subject). Prueft die drei
// I8-Invarianten gegen pglite (Postgres-in-WASM, offline, F.I.R.S.T.):
//   1. Owner-only byte-identisch (per-Tenant-Schleife mit genau einem Tenant ==
//      heutiger owner-pinned Pfad - die Bestands-Invariante haelt).
//   2. Zwei-Tenant-Round-Trip getrennt persistiert (settings/calendar/usage/numbers/
//      owner_name/idp_subject + call-verknuepfte actionItems/notifications).
//   3. RLS-WITH-CHECK blockt einen Fremd-Tenant-Insert unter gesetzter GUC.
// Rein pglite, NIE mit Server-Spawn gemischt (P6a-Stall).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, OWNER_TENANT_ID } from "../src/store/pg.js";
import { defaultSettings, demoCalendar, PROVIDER, NUMBER_STATUS } from "../src/store/defaults.js";
import { makePgTestStore } from "./pg-helpers.js";
import * as ops from "../src/store/state-ops.js";
import { config } from "../src/config.js";

// Owner-Nummern-Seed (config.twilio/telnyxNumber aus .env) ausschalten, damit die
// deterministischen Number-Asserts unabhaengig von der lokalen .env laufen und kein
// number-GRANT noetig ist (Muster wie store-pg-rls.test.js). Process-isoliert pro Datei.
config.twilioNumber = "";
config.telnyxNumber = "";

const TENANT_B = "tenant_b";
const APP_ROLE = "app_user"; // liest/schreibt unter GUC, ohne Superuser/BYPASSRLS
const PRICES = { priceInPerMTokUsd: 1.0, priceOutPerMTokUsd: 5.0, usdToEur: 0.93, maxBudgetEur: 8 };

// Baut auf einer BESTEHENDEN pglite-Instanz einen frischen Store (re-hydriert den
// Spiegel aus der DB) - so wird Persistenz statt nur In-Memory geprueft.
async function reopen(db) {
  const runner = { withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }) };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

test("Owner-only-pg: frischer Zustand byte-identisch (Bestands-Invariante haelt)", async () => {
  const { store } = await makePgTestStore();
  const s = store.load();
  assert.deepEqual(s.settings[OWNER_TENANT_ID], defaultSettings());
  assert.deepEqual(store.getCalendar(OWNER_TENANT_ID), demoCalendar());
  assert.equal(s.tenants.length, 1);
  assert.equal(s.tenants[0].id, OWNER_TENANT_ID);
  // Owner-Tenant traegt KEIN ownerName-Feld -> Owner-Fallback (config.ownerName)
  // bleibt; kein owner_name=null-Drift (seedDefaults setzt die Spalte nicht).
  assert.equal("ownerName" in s.tenants[0], false);
});

test("Zwei-Tenant-Round-Trip: settings/calendar/usage/numbers/owner_name/idp_subject getrennt persistiert", async () => {
  const { store, db } = await makePgTestStore();
  const s = store.load();

  // Tenant B ueber den Spiegel + Flush registrieren (genau der zu testende Pfad,
  // kein direkter tenant-INSERT in die DB). Identitaet (owner_name/idp_subject) setzen.
  ops.registerTenant(s, TENANT_B, { ownerName: "Maria" });
  s.tenants.find((t) => t.id === TENANT_B).idpSubject = "sub-maria";

  // B-Daten in den Spiegel (settings/calendar/usage/number).
  const iso1 = "2030-02-01T10:00:00.000Z";
  const iso2 = "2030-02-01T11:00:00.000Z";
  ops.settingsFor(s, TENANT_B).agentName = "B-Agent";
  ops.addCalendarEvent(s, TENANT_B, "B-Termin", iso1, iso2);
  ops.trackUsage(s, TENANT_B, 1_000_000, 0, PRICES);
  s.numbers.push({
    id: "num_b", e164: "+49999000111", tenantId: TENANT_B,
    provider: PROVIDER.TWILIO, status: NUMBER_STATUS.ACTIVE, providerNumberId: null,
  });

  // B-Call (scharft den calls/actionItems/notifications-Partition-Pfad).
  const cb = ops.createCall(s, { direction: "inbound", from: "+49", to: "+49999000111", tenantId: TENANT_B });
  ops.addActionItem(s, cb.id, "B-Item");
  ops.addNotification(s, "B-Notif", "x", cb.id);

  // Owner-Daten parallel mutieren (Trennung muss in beide Richtungen halten).
  const co = ops.createCall(s, { direction: "outbound", from: "+49", to: "+49", tenantId: OWNER_TENANT_ID });
  ops.addActionItem(s, co.id, "Owner-Item");

  await store.save();
  const r = await reopen(db);
  const rs = r.load();

  // settings getrennt: B geaendert, Owner unveraendert (kein Leak).
  assert.equal(rs.settings[TENANT_B].agentName, "B-Agent");
  assert.equal(rs.settings[OWNER_TENANT_ID].agentName, defaultSettings().agentName);
  // calendar getrennt: B-Termin nur bei B, Owner behaelt den Demo-Kalender.
  assert.deepEqual(r.getCalendar(TENANT_B).map((e) => e.title), ["B-Termin"]);
  assert.deepEqual(r.getCalendar(OWNER_TENANT_ID), demoCalendar());
  // usage getrennt.
  assert.equal(rs.usage[TENANT_B].inputTokens, 1_000_000);
  assert.equal(rs.usage[OWNER_TENANT_ID].inputTokens, 0);
  // number-Routing: B's Nummer loest auf B auf.
  assert.equal(r.findTenantByNumber("+49999000111"), TENANT_B);
  // tenant-Identitaet round-trippt (owner_name/idp_subject).
  assert.equal(rs.tenants.find((t) => t.id === TENANT_B).ownerName, "Maria");
  assert.equal(rs.tenants.find((t) => t.id === TENANT_B).idpSubject, "sub-maria");
  // call + actionItem + notification getrennt zugeordnet.
  assert.ok(r.getCall(cb.id), "B-Call vorhanden");
  assert.equal(r.getCall(cb.id).tenantId, TENANT_B);
  assert.ok(r.getCall(co.id), "Owner-Call separat vorhanden");
  assert.equal(r.getCall(co.id).tenantId, OWNER_TENANT_ID);
  assert.ok(rs.actionItems.some((a) => a.callId === cb.id && a.text === "B-Item"));
  assert.ok(rs.actionItems.some((a) => a.callId === co.id && a.text === "Owner-Item"));
  assert.ok(rs.notifications.some((n) => n.callId === cb.id && n.title === "B-Notif"));

  // R6: kein 'undefined'-Bucket (hydrate iteriert ueber reale DB-Tenant-Ids).
  assert.equal("undefined" in rs.settings, false);
  assert.equal("undefined" in rs.usage, false);
});

test("RLS-WITH-CHECK: Insert mit fremder tenant_id unter gesetzter GUC wird geblockt", async () => {
  // Belegt, dass ein vergessener set_config in der Flush-Schleife einen
  // Fremd-Tenant-Insert NICHT still durchlaesst: unter der App-Rolle (kein
  // Superuser/BYPASSRLS) + GUC=owner blockt die Policy (USING wirkt als WITH CHECK)
  // den call-Insert mit tenant_id=B. Eigenstaendiges Minimal-Setup (eine
  // call-Insert-Negativ-Assertion); kein datei-uebergreifender Helper (P12-Isolation).
  const { store, db } = await makePgTestStore();
  store.load(); // erzwingt init (Owner-Tenant + Schema existieren)
  await db.query(`INSERT INTO tenant (id) VALUES ($1) ON CONFLICT DO NOTHING`, [TENANT_B]);
  await db.exec(
    `CREATE ROLE ${APP_ROLE} NOLOGIN;
     GRANT SELECT, INSERT, UPDATE, DELETE ON call TO ${APP_ROLE};
     GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`
  );

  await assert.rejects(
    async () => {
      await db.query(`SET ROLE ${APP_ROLE}`);
      await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [OWNER_TENANT_ID]);
      try {
        await db.query(
          `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
           VALUES ('call_evil', $1, 'tok', 'inbound', 'active', now()::text)`,
          [TENANT_B]
        );
      } finally {
        await db.query(`RESET ROLE`);
      }
    },
    /row-level security|policy/i
  );
});
