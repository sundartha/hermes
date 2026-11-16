import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, BOOTSTRAP_TENANT_ID, makePgTestStore } from "../pg-helpers.js";

const FREMDER_MANDANT = "tenant_fremd";
const FREMDER_ANRUF = "call_fremd";
const NUMMER = "+4915112345678";

function runnerFuer(db, sperre) {
  return {
    withClient: (fn) =>
      fn({
        query: (text, params) => {
          if (sperre.aktiv && text.includes("FROM notification")) return Promise.reject(new Error("Lesen gesperrt"));
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
}

async function zweiInstanzen({ markiert = false } = {}) {
  const { store: a, db } = await makePgTestStore();
  const call = a.createCall({ direction: "inbound", from: NUMMER, to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await a.persistCall(call.id);
  if (markiert) await a.markInboxEntry(call.id, true);
  const sperre = { aktiv: false };
  const b = makePgStore(runnerFuer(db, sperre));
  await b.init();
  return { a, b, db, sperre, callId: call.id };
}

async function fremdenMandantAnlegen(db, callIdFuerPunkt) {
  await db.query(`INSERT INTO tenant (id) VALUES ($1)`, [FREMDER_MANDANT]);
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164, to_e164, goal, started_at, max_duration_s, provider)
     VALUES ($1, $2, 'tok_fremd', 'outbound', 'completed', '+4930555000201', $3, 'Ziel', $4, 600, 'telnyx')`,
    [FREMDER_ANRUF, FREMDER_MANDANT, NUMMER, new Date().toISOString()],
  );
  await db.query(
    `INSERT INTO action_item (id, tenant_id, call_id, text, type, done, created_at) VALUES ('ai_fremd', $1, $2, 'Fremder Punkt', 'todo', false, $3)`,
    [FREMDER_MANDANT, callIdFuerPunkt, new Date().toISOString()],
  );
  await db.query(
    `INSERT INTO notification (id, tenant_id, title, body, call_id, at) VALUES ('nt_fremd', $1, 'Fremde Meldung', '', $2, $3)`,
    [FREMDER_MANDANT, callIdFuerPunkt, new Date().toISOString()],
  );
}

test("Eine zweite Instanz exportiert Aktionspunkt und Benachrichtigung der ersten ohne Neustart", async () => {
  const { a, b, callId } = await zweiInstanzen();
  await a.addActionItem(callId, "Rueckruf bei Meier", "todo");
  await a.addNotification("Zusammenfassung", "Meier ruft zurueck", callId);
  const auszug = await b.exportTenantDataGelesen(BOOTSTRAP_TENANT_ID);
  assert.deepEqual(
    auszug.actionItems.map((punkt) => [punkt.callId, punkt.text, punkt.type, punkt.done]),
    [[callId, "Rueckruf bei Meier", "todo", false]],
  );
  assert.deepEqual(
    auszug.notifications.map((meldung) => [meldung.callId, meldung.title, meldung.body]),
    [[callId, "Zusammenfassung", "Meier ruft zurueck"]],
  );
});

test("SG-02 Der Export zeigt keinen Aktionspunkt und keine Benachrichtigung eines anderen Mandanten", async () => {
  const { a, b, db, callId } = await zweiInstanzen();
  await fremdenMandantAnlegen(db, callId);
  await a.addActionItem(callId, "Eigener Punkt", "todo");
  const auszug = await b.exportTenantDataGelesen(BOOTSTRAP_TENANT_ID);
  assert.deepEqual(
    auszug.actionItems.map((punkt) => punkt.id).filter((id) => id === "ai_fremd"),
    [],
  );
  assert.deepEqual(
    auszug.notifications.map((meldung) => meldung.id),
    [],
  );
  assert.deepEqual(
    auszug.actionItems.map((punkt) => punkt.text),
    ["Eigener Punkt"],
  );
});

test("Der Export mit Anruf-Grenze nennt nur Punkte und Meldungen der gelesenen Anrufe", async () => {
  const { a, b, callId } = await zweiInstanzen();
  const zweiter = a.createCall({ direction: "inbound", from: NUMMER, to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await a.persistCall(zweiter.id);
  await a.addActionItem(callId, "Alter Punkt", "todo");
  await a.addNotification("Alt", "x", callId);
  await a.addActionItem(zweiter.id, "Neuer Punkt", "todo");
  await a.addNotification("Neu", "y", zweiter.id);
  const auszug = await b.exportTenantDataGelesen(BOOTSTRAP_TENANT_ID, { anrufe: 1 });
  assert.deepEqual(
    auszug.actionItems.map((punkt) => punkt.text),
    ["Neuer Punkt"],
  );
  assert.deepEqual(
    auszug.notifications.map((meldung) => meldung.title),
    ["Neu"],
  );
});

test("Der Posteingang zeigt auf der zweiten Instanz den offenen Text der ersten und keinen erledigten", async () => {
  const { a, b, db, callId } = await zweiInstanzen({ markiert: true });
  await a.addActionItem(callId, "Erster Punkt", "todo");
  await a.addActionItem(callId, "Zweiter Punkt", "todo");
  await db.query(
    `INSERT INTO action_item (id, tenant_id, call_id, text, type, done, created_at) VALUES ('ai_erledigt', $1, $2, 'Erledigter Punkt', 'todo', true, $3)`,
    [BOOTSTRAP_TENANT_ID, callId, new Date().toISOString()],
  );
  const { entries } = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 10, includeSeen: false });
  assert.deepEqual(
    entries.map((eintrag) => [eintrag.call_id, eintrag.action_items, eintrag.action_required]),
    [[callId, ["Erster Punkt", "Zweiter Punkt"], true]],
  );
});

test("Der Posteingang nennt keinen offenen Punkt eines anderen Mandanten", async () => {
  const { b, db, callId } = await zweiInstanzen({ markiert: true });
  await fremdenMandantAnlegen(db, callId);
  const { entries } = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 10, includeSeen: false });
  assert.deepEqual(
    entries.map((eintrag) => [eintrag.call_id, eintrag.action_items, eintrag.action_required]),
    [[callId, [], false]],
  );
});

test("Ein Lesefehler im Speicher laesst den Export und den Posteingang werfen statt leere Listen zu liefern", async () => {
  const { b, sperre } = await zweiInstanzen({ markiert: true });
  sperre.aktiv = true;
  await assert.rejects(b.exportTenantDataGelesen(BOOTSTRAP_TENANT_ID), /Lesen gesperrt/);
  await assert.rejects(
    b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 10, includeSeen: false }),
    /Lesen gesperrt/,
  );
});

test("Auf einer Instanz stehen Aktionspunkte und Benachrichtigungen im Export neueste zuerst", async () => {
  const { a, callId } = await zweiInstanzen();
  await a.addActionItem(callId, "Erster Punkt", "todo");
  await a.addActionItem(callId, "Zweiter Punkt", "todo");
  await a.addNotification("Erste Meldung", "x", callId);
  await a.addNotification("Zweite Meldung", "y", callId);
  const auszug = await a.exportTenantDataGelesen(BOOTSTRAP_TENANT_ID);
  assert.deepEqual(
    auszug.actionItems.map((punkt) => punkt.text),
    ["Zweiter Punkt", "Erster Punkt"],
  );
  assert.deepEqual(
    auszug.notifications.map((meldung) => meldung.title),
    ["Zweite Meldung", "Erste Meldung"],
  );
});

test("Der Posteingang ordnet jedem Anruf nur seine eigenen offenen Punkte zu", async () => {
  const { store: a, db } = await makePgTestStore();
  const anrufe = [1, 2].map(() =>
    a.createCall({ direction: "inbound", from: NUMMER, to: "+49", tenantId: BOOTSTRAP_TENANT_ID }),
  );
  for (const [index, anruf] of anrufe.entries()) {
    await a.persistCall(anruf.id);
    await a.markInboxEntry(anruf.id, true);
    await a.addActionItem(anruf.id, `Punkt von Anruf ${index + 1}`, "todo");
  }
  const b = makePgStore(runnerFuer(db, { aktiv: false }));
  await b.init();
  const { entries } = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, {
    limit: 10,
    includeSeen: false,
  });
  const nachAnruf = Object.fromEntries(
    entries.map((eintrag) => [eintrag.call_id, eintrag.action_items]),
  );
  assert.deepEqual(nachAnruf, {
    [anrufe[0].id]: ["Punkt von Anruf 1"],
    [anrufe[1].id]: ["Punkt von Anruf 2"],
  });
});
