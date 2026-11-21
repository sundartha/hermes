import { test } from "node:test";
import assert from "node:assert/strict";

process.env.STORE_BACKEND = "pg";
process.env.DATABASE_URL = "postgres://attrappe.invalid/hermes";
const { legeMandantAn, makePgTestStore } = await import("../pg-helpers.js");
const { store, db } = await makePgTestStore();

const MANDANT_A = "t_job_a";
const MANDANT_B = "t_job_b";
const REGEL_NAME = "provisioning_job_tenant_idempotency_key";

await legeMandantAn(store, MANDANT_A);
await legeMandantAn(store, MANDANT_B);

const nummerAnlegen = (id, mandant) =>
  db.query(`INSERT INTO number (id, tenant_id) VALUES ($1, $2)`, [id, mandant]);

await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [MANDANT_A]);
await nummerAnlegen("n_job_a", MANDANT_A);
await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [MANDANT_B]);
await nummerAnlegen("n_job_b", MANDANT_B);

const jobAnlegen = async (id, mandant, schluessel) => {
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [mandant]);
  return db.query(
    `INSERT INTO provisioning_job (id, tenant_id, number_id, kind, status, idempotency_key)
     VALUES ($1, $2, $3, 'order', 'queued', $4)`,
    [id, mandant, mandant === MANDANT_A ? "n_job_a" : "n_job_b", schluessel],
  );
};

const zeilen = async (mandant, schluessel) => {
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [mandant]);
  const { rows } = await db.query(
    "SELECT id, status FROM provisioning_job WHERE tenant_id = $1 AND idempotency_key = $2 ORDER BY id",
    [mandant, schluessel],
  );
  return rows;
};

test("Datenbank lehnt dieselbe Spur desselben Kunden ein zweites Mal ab, die erste bleibt", async () => {
  await jobAnlegen("j_eins", MANDANT_A, "order_n1");
  await assert.rejects(() => jobAnlegen("j_zwei", MANDANT_A, "order_n1"), new RegExp(REGEL_NAME));
  assert.deepEqual(await zeilen(MANDANT_A, "order_n1"), [{ id: "j_eins", status: "queued" }]);
});

test("Zwei Kunden duerfen denselben Schluessel je einmal haben", async () => {
  await jobAnlegen("j_a_gleich", MANDANT_A, "order_gleich");
  await jobAnlegen("j_b_gleich", MANDANT_B, "order_gleich");
  assert.deepEqual(await zeilen(MANDANT_A, "order_gleich"), [{ id: "j_a_gleich", status: "queued" }]);
  assert.deepEqual(await zeilen(MANDANT_B, "order_gleich"), [{ id: "j_b_gleich", status: "queued" }]);
});

const bestand = async () => {
  const { rows } = await db.query("SELECT id, tenant_id, idempotency_key, status FROM provisioning_job ORDER BY id");
  return rows;
};

test("Dieselbe Spur ueber den Speicher erneut speichern aendert den Status und bleibt eine Zeile", async () => {
  await store.ensureTenant(MANDANT_A);
  const zustand = store.load();
  const spur = {
    id: "j_update",
    numberId: "n_job_a",
    tenantId: MANDANT_A,
    kind: "order",
    status: "queued",
    idempotencyKey: "order_update",
    attempts: 0,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  zustand.numbers.push({ id: "n_job_a", tenantId: MANDANT_A, e164: null, status: "requested" });
  zustand.provisioningJobs.push(spur);
  await store.save();
  assert.deepEqual(await zeilen(MANDANT_A, "order_update"), [{ id: spur.id, status: "queued" }]);
  spur.status = "done";
  await store.save();
  assert.deepEqual(await zeilen(MANDANT_A, "order_update"), [{ id: spur.id, status: "done" }]);
});

test("Migration legt die Regel auf einer Tabelle mit Bestandszeilen an und laesst die Zeilen unveraendert", async () => {
  const vorher = await bestand();
  assert.equal(vorher.length, 4);
  await db.query(`ALTER TABLE provisioning_job DROP CONSTRAINT ${REGEL_NAME}`);
  await db.query("DELETE FROM schema_migrations WHERE name = '0029_provisioning_job_eindeutig'");
  await store.init();
  const { rows } = await db.query("SELECT conname FROM pg_constraint WHERE conname = $1", [REGEL_NAME]);
  assert.deepEqual(rows, [{ conname: REGEL_NAME }]);
  assert.deepEqual(await bestand(), vorher);
  await assert.rejects(
    () =>
      db.query(
        `INSERT INTO provisioning_job (id, tenant_id, number_id, kind, status, idempotency_key)
         SELECT 'j_drei', tenant_id, number_id, kind, status, idempotency_key FROM provisioning_job WHERE idempotency_key = 'order_update'`,
      ),
    new RegExp(REGEL_NAME),
  );
});
