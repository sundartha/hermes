import { test } from "node:test";
import assert from "node:assert/strict";

process.env.STORE_BACKEND = "pg";
process.env.DATABASE_URL = "postgres://attrappe.invalid/hermes";
const { legeMandantAn, makePgTestStore } = await import("../pg-helpers.js");
const { store, db } = await makePgTestStore();

const MANDANT = "t_zustand_regel";
const REGEL_NAME = "call_status_zustand_check";

await legeMandantAn(store, MANDANT);

const anlegen = (id, status) =>
  db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
     VALUES ($1, $2, $3, 'inbound', $4, now()::text)`,
    [id, MANDANT, `tok_${id}`, status],
  );

const regel = async () =>
  (await db.query("SELECT convalidated FROM pg_constraint WHERE conname = $1", [REGEL_NAME])).rows;

test("Datenbank lehnt einen neuen Anruf mit unbekanntem Zustand ab", async () => {
  await assert.rejects(() => anlegen("z_neu_bogus", "bogus"), /call_status_zustand_check/);
  const { rows } = await db.query("SELECT id FROM call WHERE id = $1", ["z_neu_bogus"]);
  assert.deepEqual(rows, []);
});

test("Datenbank nimmt jeden der vier gueltigen Zustaende an", async () => {
  for (const status of ["active", "completed", "failed", "cancelled"]) {
    await anlegen(`z_ok_${status}`, status);
  }
  const { rows } = await db.query("SELECT status FROM call WHERE id LIKE 'z_ok_%' ORDER BY status");
  assert.deepEqual(
    rows.map((zeile) => zeile.status),
    ["active", "cancelled", "completed", "failed"],
  );
});

test("Datenbank lehnt die Aenderung eines Anrufs auf einen unbekannten Zustand ab und laesst den Zustand stehen", async () => {
  await anlegen("z_update", "active");
  await assert.rejects(
    () => db.query("UPDATE call SET status = 'bogus' WHERE id = $1", ["z_update"]),
    /call_status_zustand_check/,
  );
  await db.query("UPDATE call SET status = 'completed' WHERE id = $1", ["z_update"]);
  const { rows } = await db.query("SELECT status FROM call WHERE id = $1", ["z_update"]);
  assert.deepEqual(rows, [{ status: "completed" }]);
});

const MIGRATION_VERGESSEN = "DELETE FROM schema_migrations WHERE name = '0026_anruf_zustand_pruefregel'";

test("Pruefregel ist ungeprueft angelegt und ein zweiter Lauf der Migration aendert nichts", async () => {
  assert.deepEqual(await regel(), [{ convalidated: false }]);
  await db.query(MIGRATION_VERGESSEN);
  await store.init();
  assert.deepEqual(await regel(), [{ convalidated: false }]);
  await assert.rejects(() => anlegen("z_zweiter_lauf", "bogus"), /call_status_zustand_check/);
});

test("Migration prueft Bestandszeilen nicht nach: eine Zeile mit unbekanntem Zustand bleibt, neue werden weiter abgelehnt", async () => {
  await db.query(`ALTER TABLE call DROP CONSTRAINT ${REGEL_NAME}`);
  await anlegen("z_bestand_bogus", "bogus");
  await db.query(MIGRATION_VERGESSEN);
  await assert.rejects(() => store.init(), /Anruf z_bestand_bogus: unbekannter Zustand "bogus"/);
  assert.deepEqual(await regel(), [{ convalidated: false }]);
  const { rows } = await db.query("SELECT status FROM call WHERE id = $1", ["z_bestand_bogus"]);
  assert.deepEqual(rows, [{ status: "bogus" }]);
  await assert.rejects(() => anlegen("z_nach_migration", "bogus"), /call_status_zustand_check/);
});
