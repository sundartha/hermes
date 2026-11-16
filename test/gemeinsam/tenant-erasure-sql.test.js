import { test } from "node:test";
import assert from "node:assert/strict";
import { neuePglite } from "../pglite-helfer.js";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../../src/store/pg.js";

const OTHER = "other";

function runnerFuer(db, vorQuery = () => {}) {
  return {
    withClient: (fn) =>
      fn({
        query: (text, params) => {
          vorQuery(text);
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
}

async function aufbau(vorQuery) {
  const db = await neuePglite();
  const store = makePgStore(runnerFuer(db, vorQuery));
  await store.init();
  await db.query(`INSERT INTO tenant (id) VALUES ($1) ON CONFLICT DO NOTHING`, [OTHER]);
  return { store, db };
}

async function anrufEinfuegen(db, { tenantId, id, texte }) {
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
     VALUES ($1, $2, $3, 'inbound', 'ended', now()::text)`,
    [id, tenantId, `tok_${id}`],
  );
  for (const text of texte) {
    await db.query(
      `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1,$2,'caller',$3,now()::text)`,
      [id, tenantId, text],
    );
  }
}

const anzahl = async (db, tabelle, tenantId) => {
  const { rows } = await db.query(`SELECT count(*) AS n FROM ${tabelle} WHERE tenant_id=$1`, [tenantId]);
  return Number(rows[0].n);
};

test("Mandant loeschen: Anrufe nur einer anderen Instanz verschwinden aus der Datenbank und stehen in der Zaehlung", async () => {
  const { store, db } = await aufbau();
  const eigener = store.createCall({ direction: "inbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  store.addTranscript(eigener.id, "caller", "lokal");
  await store.save();
  await anrufEinfuegen(db, { tenantId: BOOTSTRAP_TENANT_ID, id: "call_andere_instanz", texte: ["eins", "zwei", "drei"] });
  await anrufEinfuegen(db, { tenantId: OTHER, id: "call_fremd", texte: ["bleibt"] });

  const removed = await store.eraseTenantData(BOOTSTRAP_TENANT_ID);

  assert.equal(removed.calls, 2);
  assert.equal(removed.transcriptSegments, 4);
  assert.equal(await anzahl(db, "call", BOOTSTRAP_TENANT_ID), 0);
  assert.equal(await anzahl(db, "transcript_segment", BOOTSTRAP_TENANT_ID), 0);
  assert.equal(await anzahl(db, "call", OTHER), 1);
  assert.equal(await anzahl(db, "transcript_segment", OTHER), 1);
});

test("Mandant loeschen: ein Datenbankfehler wirft und laesst Zustand und Anrufe unveraendert", async () => {
  let kaputt = false;
  const { store, db } = await aufbau((text) => {
    if (kaputt && text.includes("DELETE FROM call")) throw new Error("Datenbank weg");
  });
  const eigener = store.createCall({ direction: "inbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await store.save();

  kaputt = true;
  await assert.rejects(() => store.eraseTenantData(BOOTSTRAP_TENANT_ID), /Datenbank weg/);
  kaputt = false;

  assert.equal(await anzahl(db, "call", BOOTSTRAP_TENANT_ID), 1);
  assert.ok(store.load().calls.some((call) => call.id === eigener.id));
});

test("Mandant loeschen: ohne Anrufe zaehlt die Datenbank null", async () => {
  const { store } = await aufbau();
  const removed = await store.eraseTenantData(BOOTSTRAP_TENANT_ID);
  assert.equal(removed.calls, 0);
  assert.equal(removed.transcriptSegments, 0);
});
