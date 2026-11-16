import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeInboxRoutes } from "../../src/routes/api-inbox.ts";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makePgStore, BOOTSTRAP_TENANT_ID, makePgTestStore } from "../pg-helpers.js";

const FREMDER_MANDANT = "tenant_fremd";
const RUECKRUF = "Rueckruf bei Meier";
const ANGEBOT = "Angebot schicken";
const TERMIN = "Termin bestaetigen";

function runnerFuer(db, ausfall, protokoll = []) {
  return {
    withClient: (fn) =>
      fn({
        query: (text, params) => {
          protokoll.push({ text, params });
          if (ausfall.aktiv && text.includes("FROM action_item")) throw new Error("Lesefehler");
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
}

async function zweiInstanzen({ vorB, protokoll } = {}) {
  const { store: a, db } = await makePgTestStore();
  const call = a.createCall({
    direction: "inbound",
    from: "+4915112345678",
    to: "+49",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  await a.persistCall(call.id);
  if (vorB) await vorB(a, call.id);
  const ausfall = { aktiv: false };
  const b = makePgStore(runnerFuer(db, ausfall, protokoll));
  await b.init();
  return { a, b, db, callId: call.id, ausfall };
}

const FREMDER_ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164,
  to_e164, goal, started_at, answered_at, max_duration_s, provider)
  VALUES ('call_fremd', $1, 'tok_fremd', 'outbound', 'completed', '+4915100000001', '+4915100000002', 'x',
  '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 60, 'telnyx')`;

const texte = (liste) => liste.map((eintrag) => eintrag.text ?? eintrag.title);

test("Eine zweite Instanz exportiert den Aktionspunkt und die Benachrichtigung der ersten ohne Neustart", async () => {
  const { a, b, callId } = await zweiInstanzen();
  await a.addActionItem(callId, RUECKRUF, "todo");
  await a.addNotification("Zusammenfassung", "Meier ruft zurueck", callId);
  const daten = await b.exportTenantData(BOOTSTRAP_TENANT_ID);
  assert.deepEqual(texte(daten.actionItems), [RUECKRUF]);
  assert.equal(daten.actionItems[0].callId, callId);
  assert.equal(daten.actionItems[0].done, false);
  assert.equal(daten.actionItems[0].type, "todo");
  assert.deepEqual(texte(daten.notifications), ["Zusammenfassung"]);
  assert.equal(daten.notifications[0].body, "Meier ruft zurueck");
  assert.equal(daten.notifications[0].callId, callId);
});

test("Eine zweite Instanz liest Aktionspunkt und Benachrichtigung der ersten über exportTenantDataGelesen ohne Neustart", async () => {
  const { a, b, callId } = await zweiInstanzen();
  await a.addActionItem(callId, RUECKRUF, "todo");
  await a.addNotification("Zusammenfassung", "Meier ruft zurueck", callId);
  const daten = await b.exportTenantDataGelesen(BOOTSTRAP_TENANT_ID);
  assert.deepEqual(texte(daten.actionItems), [RUECKRUF]);
  assert.equal(daten.actionItems[0].callId, callId);
  assert.deepEqual(texte(daten.notifications), ["Zusammenfassung"]);
  assert.equal(daten.notifications[0].body, "Meier ruft zurueck");
});

test("SG-02 Eintraege eines anderen Mandanten erscheinen in exportTenantDataGelesen nie", async () => {
  const { a, b, db, callId } = await zweiInstanzen();
  await db.query(`INSERT INTO tenant (id) VALUES ($1)`, [FREMDER_MANDANT]);
  await db.query(FREMDER_ANRUF_SQL, [FREMDER_MANDANT]);
  await db.query(
    `INSERT INTO action_item (id, tenant_id, call_id, text, type, done, created_at) VALUES ('ai_fremd', $1, 'call_fremd', 'Fremder Punkt', 'todo', false, '2026-01-01T00:00:00Z')`,
    [FREMDER_MANDANT],
  );
  await db.query(
    `INSERT INTO notification (id, tenant_id, title, body, call_id, at) VALUES ('nt_fremd', $1, 'Fremd', '', 'call_fremd', '2026-01-01T00:00:00Z')`,
    [FREMDER_MANDANT],
  );
  await a.addActionItem(callId, RUECKRUF, "todo");
  await a.addNotification("Eigene", "x", callId);
  const daten = await b.exportTenantDataGelesen(BOOTSTRAP_TENANT_ID);
  assert.deepEqual(texte(daten.actionItems), [RUECKRUF]);
  assert.deepEqual(texte(daten.notifications), ["Eigene"]);
});

test("SG-02 Eintraege eines anderen Mandanten erscheinen im Export nie", async () => {
  const { a, b, db, callId } = await zweiInstanzen();
  await db.query(`INSERT INTO tenant (id) VALUES ($1)`, [FREMDER_MANDANT]);
  await db.query(FREMDER_ANRUF_SQL, [FREMDER_MANDANT]);
  await db.query(
    `INSERT INTO action_item (id, tenant_id, call_id, text, type, done, created_at) VALUES ('ai_fremd', $1, 'call_fremd', 'Fremder Punkt', 'todo', false, '2026-01-01T00:00:00Z')`,
    [FREMDER_MANDANT],
  );
  await db.query(
    `INSERT INTO notification (id, tenant_id, title, body, call_id, at) VALUES ('nt_fremd', $1, 'Fremd', '', 'call_fremd', '2026-01-01T00:00:00Z')`,
    [FREMDER_MANDANT],
  );
  await a.addActionItem(callId, RUECKRUF, "todo");
  await a.addNotification("Eigene", "x", callId);
  const daten = await b.exportTenantData(BOOTSTRAP_TENANT_ID);
  assert.deepEqual(texte(daten.actionItems), [RUECKRUF]);
  assert.deepEqual(texte(daten.notifications), ["Eigene"]);
  const fremd = await b.exportTenantData(FREMDER_MANDANT);
  assert.deepEqual(texte(fremd.actionItems), ["Fremder Punkt"]);
  assert.deepEqual(texte(fremd.notifications), ["Fremd"]);
});

test("Der Posteingang einer zweiten Instanz zeigt den offenen Text der ersten und keinen erledigten", async () => {
  const { a, b, db, callId } = await zweiInstanzen({ vorB: (a, id) => a.markInboxEntry(id, true) });
  await a.addActionItem(callId, RUECKRUF, "todo");
  await a.addActionItem(callId, ANGEBOT, "todo");
  await a.addActionItem(callId, TERMIN, "todo");
  await db.query(`UPDATE action_item SET done = true WHERE text = $1`, [ANGEBOT]);
  const { entries } = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 10, includeSeen: false });
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].action_items, [RUECKRUF, TERMIN]);
  assert.equal(entries[0].action_required, true);
});

test("Ein Lesefehler beim Export wirft statt leere Listen zu liefern", async () => {
  const { b, ausfall } = await zweiInstanzen();
  ausfall.aktiv = true;
  await assert.rejects(() => b.exportTenantData(BOOTSTRAP_TENANT_ID), /Lesefehler/);
});

test("Ein Lesefehler beim Posteingang wirft und markiert nichts als gesehen", async () => {
  const { b, ausfall, callId } = await zweiInstanzen({ vorB: (a, id) => a.markInboxEntry(id, true) });
  ausfall.aktiv = true;
  await assert.rejects(() => b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 10, includeSeen: false }), /Lesefehler/);
  assert.equal(b.getCall(callId).inboxSeenAt ?? null, null);
});

test("Auf einer Instanz stehen Aktionspunkte und Benachrichtigungen im Export neueste zuerst", async () => {
  const { a, callId } = await zweiInstanzen();
  await a.addActionItem(callId, RUECKRUF, "todo");
  await a.addActionItem(callId, ANGEBOT, "todo");
  await a.addActionItem(callId, TERMIN, "todo");
  await a.addNotification("Eins", "x", callId);
  await a.addNotification("Zwei", "x", callId);
  await a.addNotification("Drei", "x", callId);
  const daten = await a.exportTenantData(BOOTSTRAP_TENANT_ID);
  assert.deepEqual(texte(daten.actionItems), [TERMIN, ANGEBOT, RUECKRUF]);
  assert.deepEqual(texte(daten.notifications), ["Drei", "Zwei", "Eins"]);
});

test("Der Posteingang zeigt fuer einen Anruf ohne Aktionspunkte eine leere Liste", async () => {
  let leer = null;
  const { a, b, callId } = await zweiInstanzen({
    vorB: async (a, id) => {
      await a.markInboxEntry(id, true);
      const zweiter = a.createCall({ direction: "inbound", from: "+4915199999999", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
      await a.persistCall(zweiter.id);
      await a.markInboxEntry(zweiter.id, true);
      leer = zweiter.id;
    },
  });
  await a.addActionItem(callId, RUECKRUF, "todo");
  const { entries } = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 10, includeSeen: false });
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.find((e) => e.call_id === leer).action_items, []);
  assert.deepEqual(entries.find((e) => e.call_id === callId).action_items, [RUECKRUF]);
});

async function pollen(store) {
  const app = express();
  app.use(makeInboxRoutes({ store, audit: () => {}, tenant: { requireTenant: () => BOOTSTRAP_TENANT_ID } }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/inbox/poll`, { method: "POST" });
    return { status: res.status, text: await res.text() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Die Poll-Route wartet auf den Speicher und liefert dessen Eintraege", async () => {
  const eintrag = { call_id: "call_x", action_items: [RUECKRUF] };
  const store = { takeInboxEntries: async () => ({ entries: [eintrag], remaining: 3, marked: 1 }) };
  const { status, text } = await pollen(store);
  assert.equal(status, 200);
  assert.deepEqual(JSON.parse(text), { entries: [eintrag], remaining: 3 });
});

test("Die Poll-Route antwortet mit 500, wenn der Speicher beim Lesen wirft", async () => {
  const store = { takeInboxEntries: async () => { throw new Error("Lesefehler"); } };
  const { status } = await pollen(store);
  assert.equal(status, 500);
});

test("Der Export setzt den Mandanten-Kontext vor dem Lesen der Tabellen", async () => {
  const protokoll = [];
  const { b } = await zweiInstanzen({ protokoll });
  protokoll.length = 0;
  await b.exportTenantData(BOOTSTRAP_TENANT_ID);
  const kontext = protokoll.findIndex((e) => e.text.includes("set_config"));
  const punkte = protokoll.findIndex((e) => e.text.includes("FROM action_item"));
  assert.ok(kontext >= 0);
  assert.ok(kontext < punkte);
  assert.deepEqual(protokoll[kontext].params, [BOOTSTRAP_TENANT_ID]);
});

test("Der Posteingang beachtet die Grenze und zeigt Gesehenes nur auf Wunsch erneut", async () => {
  const { b } = await zweiInstanzen({
    vorB: async (a, id) => {
      await a.markInboxEntry(id, true);
      const zweiter = a.createCall({ direction: "inbound", from: "+4915199999999", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
      await a.persistCall(zweiter.id);
      await a.markInboxEntry(zweiter.id, true);
    },
  });
  const erste = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 1, includeSeen: false });
  assert.equal(erste.entries.length, 1);
  assert.equal(erste.remaining, 1);
  assert.equal(erste.marked, 1);
  const ungesehen = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 10, includeSeen: false });
  assert.equal(ungesehen.entries.length, 1);
  const gesehen = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 10, includeSeen: true });
  assert.equal(gesehen.entries.length, 2);
  assert.equal(gesehen.marked, 0);
});

test("Nach der Aufbewahrung zeigt der Export keinen offenen Punkt und keine Meldung eines geloeschten Anrufs", async () => {
  const { a, callId } = await zweiInstanzen();
  await a.addActionItem(callId, RUECKRUF, "todo");
  await a.addNotification("Zusammenfassung", "x", callId);
  Object.assign(a.getCall(callId), { status: "completed", endedAt: "2020-01-02T03:04:05.000Z" });
  await a.save();
  await a.drainFlushes();
  const entfernt = await a.pruneOldData(30, 7, 7);
  assert.equal(entfernt.calls, 1);
  const daten = await a.exportTenantData(BOOTSTRAP_TENANT_ID);
  assert.deepEqual(daten.calls, []);
  assert.deepEqual(daten.actionItems, []);
  assert.deepEqual(daten.notifications, []);
});
