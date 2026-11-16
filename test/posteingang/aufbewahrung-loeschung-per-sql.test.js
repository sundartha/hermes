import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore, BOOTSTRAP_TENANT_ID, makePgTestStore } from "../pg-helpers.js";

const FRIST_TAGE = 30;
const MS_JE_TAG = 86_400_000;
const FREMDER_MANDANT = "tenant_fremd";

function runnerFuer(db, protokoll) {
  return {
    withClient: (fn) =>
      fn({
        query: (text, params) => {
          protokoll.push(text);
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
}

async function zweiInstanzen(protokoll = []) {
  const { store: a, db } = await makePgTestStore();
  const call = a.createCall({
    direction: "inbound",
    from: "+4915112345678",
    to: "+49",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  await a.persistCall(call.id);
  const b = makePgStore(runnerFuer(db, protokoll));
  await b.init();
  return { a, b, db, callId: call.id };
}

const meldungen = async (db, mandant = BOOTSTRAP_TENANT_ID) =>
  (
    await db.query(`SELECT id FROM notification WHERE tenant_id = $1 ORDER BY id`, [mandant])
  ).rows.map((z) => z.id);

async function meldungEinfuegen(db, id, zeit) {
  await db.query(
    `INSERT INTO notification (id, tenant_id, title, body, call_id, at) VALUES ($1,$2,'t','b',NULL,$3)`,
    [id, BOOTSTRAP_TENANT_ID, zeit],
  );
}

test("Die Mandanten-Loeschung entfernt Benachrichtigungen, die nur eine andere Instanz kennt, und laesst fremde Mandanten stehen", async () => {
  const { a, b, db, callId } = await zweiInstanzen();
  await db.query(`INSERT INTO tenant (id) VALUES ($1)`, [FREMDER_MANDANT]);
  await db.query(
    `INSERT INTO notification (id, tenant_id, title, body, call_id, at) VALUES ('nt_fremd', $1, 'Fremd', '', NULL, '2026-01-01T00:00:00Z')`,
    [FREMDER_MANDANT],
  );
  await a.addNotification("Zusammenfassung", "+4915112345678: Geheim", callId);
  await meldungEinfuegen(db, "nt_ohne_anruf", new Date().toISOString());
  await b.eraseTenantData(BOOTSTRAP_TENANT_ID);
  assert.deepEqual(await meldungen(db), []);
  assert.deepEqual(await meldungen(db, FREMDER_MANDANT), ["nt_fremd"]);
});

test("Die Mandanten-Loeschung loescht den Anruf zuerst und danach Aktionspunkte und Benachrichtigungen in eigenen Anweisungen", async () => {
  const protokoll = [];
  const { b } = await zweiInstanzen(protokoll);
  protokoll.length = 0;
  await b.eraseTenantData(BOOTSTRAP_TENANT_ID);
  const anruf = protokoll.findIndex((text) => text.includes("DELETE FROM call"));
  const punkte = protokoll.findIndex((text) => text.includes("DELETE FROM action_item"));
  const meldung = protokoll.findIndex((text) => text.includes("DELETE FROM notification"));
  assert.ok(anruf >= 0);
  assert.ok(punkte > anruf);
  assert.ok(meldung > anruf);
  assert.equal(protokoll[anruf].includes("action_item"), false);
});

test("Ein Aktionspunkt wird mit Sperre auf die Anrufzeile angelegt, damit die Mandanten-Loeschung auf ihn wartet", async () => {
  const protokoll = [];
  const { b, callId } = await zweiInstanzen(protokoll);
  await b.addActionItem(callId, "Rueckruf bei Meier", "todo");
  const anlegen = protokoll.find((text) => text.includes("INSERT INTO action_item"));
  assert.match(anlegen, /FOR SHARE/);
});

test("Die Aufbewahrung loescht abgelaufene Benachrichtigungen, auch fremde, und laesst frische stehen", async () => {
  const { a, b, db } = await zweiInstanzen();
  const alt = new Date(Date.now() - 2 * FRIST_TAGE * MS_JE_TAG).toISOString();
  await meldungEinfuegen(db, "nt_alt", alt);
  await meldungEinfuegen(db, "nt_frisch", new Date().toISOString());
  await b.pruneOldData(0, FRIST_TAGE, FRIST_TAGE);
  assert.deepEqual(await meldungen(db), ["nt_alt", "nt_frisch"]);
  await a.pruneOldData(FRIST_TAGE, FRIST_TAGE, FRIST_TAGE);
  assert.deepEqual(await meldungen(db), ["nt_frisch"]);
});

test("Die Aufbewahrung loescht abgelaufene Benachrichtigungen jedes Mandanten", async () => {
  const { a, db } = await zweiInstanzen();
  await db.query(`INSERT INTO tenant (id) VALUES ($1)`, [FREMDER_MANDANT]);
  const alt = new Date(Date.now() - 2 * FRIST_TAGE * MS_JE_TAG).toISOString();
  await db.query(
    `INSERT INTO notification (id, tenant_id, title, body, call_id, at) VALUES ('nt_fremd_alt', $1, 't', 'b', NULL, $2)`,
    [FREMDER_MANDANT, alt],
  );
  await a.pruneOldData(FRIST_TAGE, FRIST_TAGE, FRIST_TAGE);
  assert.deepEqual(await meldungen(db, FREMDER_MANDANT), []);
});
