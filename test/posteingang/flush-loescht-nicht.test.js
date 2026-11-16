import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { makePgStore, BOOTSTRAP_TENANT_ID, makePgTestStore, legeMandantAn } from "../pg-helpers.js";

const FRIST_TAGE = 30;
const MS_JE_TAG = 86_400_000;
const MAX_MELDUNGEN = 50;

const runnerFuer = (db) => ({ withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }) });

async function zweiteInstanz(db) {
  const store = makePgStore(runnerFuer(db));
  await store.init();
  return store;
}

async function erfassterAnruf(store) {
  const call = store.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await store.persistCall(call.id);
  return call;
}

const neuerPunkt = (zustand, { callId, id, text }) => {
  const item = { id, callId, text, type: "todo", done: false, createdAt: "2026-01-01T00:00:00Z" };
  zustand.actionItems.unshift(item);
  return item;
};
const neueMeldung = (zustand, { callId, id, title }) =>
  zustand.notifications.unshift({ id, title, body: "x", callId, at: "2026-01-01T00:00:00Z" });

const punkte = async (db) => (await db.query(`SELECT id, text, done FROM action_item ORDER BY seq`)).rows;
const meldungen = async (db) => (await db.query(`SELECT title, call_id FROM notification ORDER BY seq`)).rows;

test("Das Speichern auf einer Instanz loescht keinen Aktionspunkt und keine Benachrichtigung, die eine andere Instanz geschrieben hat", async () => {
  const { store: a, db } = await makePgTestStore();
  const call = await erfassterAnruf(a);
  const b = await zweiteInstanz(db);
  await a.addActionItem(call.id, "Rueckruf bei Meier", "todo");
  await a.addNotification("Zusammenfassung", "Meier ruft zurueck", call.id);
  await b.save();
  assert.deepEqual((await punkte(db)).map((zeile) => zeile.text), ["Rueckruf bei Meier"]);
  assert.deepEqual((await meldungen(db)).map((zeile) => zeile.title), ["Zusammenfassung"]);
});

test("Ein von der Aufbewahrung geloeschter erledigter Aktionspunkt kommt beim Speichern einer Instanz, die ihn noch im Spiegel hat, nicht zurueck", async () => {
  const { store: a, db } = await makePgTestStore();
  const call = await erfassterAnruf(a);
  const alt = new Date(Date.now() - 2 * FRIST_TAGE * MS_JE_TAG).toISOString();
  await db.query(
    `INSERT INTO action_item (id, tenant_id, call_id, text, type, done, created_at) VALUES ('ai_alt', $1, $2, 'Alt', 'todo', true, $3)`,
    [BOOTSTRAP_TENANT_ID, call.id, alt],
  );
  const b = await zweiteInstanz(db);
  await a.pruneOldData(FRIST_TAGE, FRIST_TAGE, FRIST_TAGE);
  assert.deepEqual(await punkte(db), []);
  await b.save();
  assert.deepEqual(await punkte(db), []);
});

test("Ein Aktionspunkt zu einem Anruf, der noch nicht in der Datenbank steht, wird nach persistCall und Speichern geschrieben", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await store.addActionItem(call.id, "Rueckruf bei Meier", "todo");
  await store.persistCall(call.id);
  await store.save();
  assert.deepEqual((await punkte(db)).map((zeile) => [zeile.text, zeile.done]), [["Rueckruf bei Meier", false]]);
});

test("Ein nachgeschriebener Aktionspunkt wird beim naechsten Speichern nicht noch einmal geschrieben", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await store.addActionItem(call.id, "Rueckruf bei Meier", "todo");
  await store.save();
  assert.equal((await punkte(db)).length, 1);
  await db.query(`DELETE FROM action_item`);
  await store.save();
  assert.deepEqual(await punkte(db), []);
});

test("Eine Benachrichtigung zu einem Anruf, der noch nicht in der Datenbank steht, wird beim Speichern geschrieben und danach nicht erneut", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await store.addNotification("Zusammenfassung", "Text", call.id);
  await store.save();
  assert.deepEqual(await meldungen(db), [{ title: "Zusammenfassung", call_id: call.id }]);
  await db.query(`DELETE FROM notification`);
  await store.save();
  assert.deepEqual(await meldungen(db), []);
});

test("Eine Benachrichtigung ohne Anruf wird beim Speichern geschrieben und auf 50 je Mandant gekuerzt", async () => {
  const { store, db } = await makePgTestStore();
  for (let i = 0; i < MAX_MELDUNGEN; i++) {
    await db.query(
      `INSERT INTO notification (id, tenant_id, title, body, call_id, at) VALUES ($1,$2,'alt','b',NULL,'2026-01-01T00:00:00Z')`,
      [`nt_alt_${i}`, BOOTSTRAP_TENANT_ID],
    );
  }
  store.addNotification("Neu", "ohne Anruf");
  await store.save();
  const titel = (await meldungen(db)).map((zeile) => zeile.title);
  assert.equal(titel.length, MAX_MELDUNGEN);
  assert.equal(titel.at(-1), "Neu");
});

test("Ein Punkt eines Anrufs, dessen Mandant auf dieser Instanz geloescht wurde, wird beim Speichern nicht geschrieben", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await store.addActionItem(call.id, "Rueckruf bei Meier", "todo");
  await store.addNotification("Zusammenfassung", "Text", call.id);
  await store.eraseTenantData(BOOTSTRAP_TENANT_ID);
  await store.save();
  assert.deepEqual(await punkte(db), []);
  assert.deepEqual(await meldungen(db), []);
});

test("Ein Umschalten des Aktionspunkts auf einer Instanz steht nach dem Speichern in der Tabelle", async () => {
  const { store: a, db } = await makePgTestStore();
  const call = await erfassterAnruf(a);
  const { item } = await a.addActionItem(call.id, "Rueckruf bei Meier", "todo");
  a.toggleActionItem(item.id);
  await a.save();
  assert.deepEqual((await punkte(db)).map((zeile) => zeile.done), [true]);
  a.toggleActionItem(item.id);
  await a.save();
  assert.deepEqual((await punkte(db)).map((zeile) => zeile.done), [false]);
});

test("Eine Instanz schreibt einen Aktionspunkt und eine Benachrichtigung, die schon in der Datenbank stehen und dort geloescht wurden, nicht noch einmal", async () => {
  const { store: a, db } = await makePgTestStore();
  const call = await erfassterAnruf(a);
  const b = await zweiteInstanz(db);
  await a.addActionItem(call.id, "Rueckruf bei Meier", "todo");
  await b.addActionItem(call.id, "Rueckruf bei Meier", "todo");
  await b.addActionItem(call.id, "Termin verschieben", "todo");
  await a.addNotification("Zusammenfassung", "Text", call.id);
  await db.query(`DELETE FROM action_item`);
  await db.query(`DELETE FROM notification`);
  await a.save();
  await b.save();
  assert.deepEqual(await punkte(db), []);
  assert.deepEqual(await meldungen(db), []);
});

test("Nachzuschreibende Aktionspunkte und Benachrichtigungen werden in der Reihenfolge ihres Anlegens geschrieben", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  const zustand = store.load();
  neuerPunkt(zustand, { callId: call.id, id: "ai_1", text: "Erster" });
  neuerPunkt(zustand, { callId: call.id, id: "ai_2", text: "Zweiter" });
  neueMeldung(zustand, { callId: call.id, id: "nt_1", title: "Erste" });
  neueMeldung(zustand, { callId: call.id, id: "nt_2", title: "Zweite" });
  await store.save();
  assert.deepEqual((await punkte(db)).map((zeile) => zeile.text), ["Erster", "Zweiter"]);
  assert.deepEqual((await meldungen(db)).map((zeile) => zeile.title), ["Erste", "Zweite"]);
});

test("Schlaegt das Umschalten eines Aktionspunkts in der Datenbank fehl, wird der Fehler gemeldet und nicht still verworfen", async () => {
  const { store: a, db } = await makePgTestStore();
  const call = await erfassterAnruf(a);
  const { item } = await a.addActionItem(call.id, "Rueckruf bei Meier", "todo");
  const b = makePgStore({
    withClient: (fn) =>
      fn({
        query: (text, params) => {
          if (text.startsWith("UPDATE action_item")) throw new Error("Umschalten kaputt");
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  });
  await b.init();
  const meldung = mock.method(console, "error", () => {});
  b.toggleActionItem(item.id);
  await b.drainFlushes().catch(() => {});
  const aufrufe = meldung.mock.calls;
  meldung.mock.restore();
  assert.deepEqual(
    aufrufe.map((aufruf) => aufruf.arguments.join(" ")).filter((text) => text.includes("Umschalten")),
    ["[pg] Umschalten des Aktionspunkts fehlgeschlagen: Umschalten kaputt"],
  );
});

test("Das Umschalten eines Aktionspunkts, dessen Anruf auf dieser Instanz nicht mehr bekannt ist, kippt den Spiegel und wirft nicht", async () => {
  const { store } = await makePgTestStore();
  const item = neuerPunkt(store.load(), { callId: "call_unbekannt", id: "ai_x", text: "Rueckruf" });
  const meldung = mock.method(console, "error", () => {});
  const umgeschaltet = store.toggleActionItem(item.id);
  await store.drainFlushes().catch(() => {});
  meldung.mock.restore();
  assert.equal(umgeschaltet.done, true);
  assert.equal(meldung.mock.callCount(), 0);
});

test("Ein Aktionspunkt, dessen Anruf nur im Spiegel steht, loest ein eigenes Speichern aus und steht danach in der Tabelle", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await store.drainFlushes();
  await db.query(`DELETE FROM call`);
  await store.addActionItem(call.id, "Rueckruf bei Meier", "todo");
  await store.drainFlushes();
  assert.deepEqual((await punkte(db)).map((zeile) => zeile.text), ["Rueckruf bei Meier"]);
});

test("Das Umschalten eines unbekannten Aktionspunkts liefert nichts, wirft nicht und stoesst kein Speichern an", async () => {
  const { store, db } = await makePgTestStore();
  const call = await erfassterAnruf(store);
  await store.addActionItem(call.id, "Rueckruf bei Meier", "todo");
  const meldung = mock.method(console, "error", () => {});
  const umgeschaltet = store.toggleActionItem("ai_gibt_es_nicht");
  await store.drainFlushes();
  meldung.mock.restore();
  assert.equal(umgeschaltet, undefined);
  assert.equal(meldung.mock.callCount(), 0);
  assert.deepEqual((await punkte(db)).map((zeile) => zeile.done), [false]);
});

test("Ein Punkt eines Anrufs, dessen Mandant auf dieser Instanz nicht im Spiegel steht, wird beim Speichern nicht geschrieben", async () => {
  const { store, db } = await makePgTestStore();
  await legeMandantAn(store, "tenant_zwei");
  const eigener = store.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  const fremder = store.createCall({ direction: "inbound", from: "+4915112345679", to: "+49", tenantId: "tenant_zwei" });
  await store.persistCall(eigener.id);
  await store.persistCall(fremder.id);
  neuerPunkt(store.load(), { callId: fremder.id, id: "ai_fremd", text: "Rueckruf fremd" });
  neuerPunkt(store.load(), { callId: eigener.id, id: "ai_eigen", text: "Rueckruf eigen" });
  await store.save();
  assert.equal((await db.query(`SELECT id FROM call`)).rows.length, 2);
  assert.deepEqual((await punkte(db)).map((zeile) => zeile.id), ["ai_eigen"]);
});
