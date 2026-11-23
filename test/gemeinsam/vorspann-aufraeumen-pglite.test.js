import { test } from "node:test";
import assert from "node:assert/strict";

import { oeffneSpeicherAn } from "./speicher-oeffnen.js";

const A = "t_va_a";
const B = "t_va_b";

process.env.STORE_BACKEND = "pg";
process.env.DATABASE_URL = "postgres://attrappe.invalid/hermes";
const { pgliteAlsRolleOhneSuperuser } = await import("../pg-helpers.js");
const { poolAufPglite } = await import("../abrechnung/server-mit-testdatenbank.js");
const db = await pgliteAlsRolleOhneSuperuser();
poolAufPglite(db);
const speicher = await import("../../src/store.js").then(oeffneSpeicherAn);

const kontext = (tenantId) => db.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
for (const id of [A, B]) {
  await kontext(id);
  await db.query("INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)", [id]);
}

const zeile = async (tenantId, callId) => {
  await kontext(tenantId);
  const { rows } = await db.query("SELECT token, text FROM vorspann_zustand WHERE call_id = $1", [callId]);
  return rows[0];
};

const anlegen = async (tenantId, callId, ablauf) => {
  await kontext(tenantId);
  await db.query(
    `INSERT INTO vorspann_zustand (call_id, tenant_id, token, text, expires_at) VALUES ($1, $2, $3, $4, now() + $5::interval)`,
    [callId, tenantId, `tok_${callId}`, `satz_${callId}`, ablauf],
  );
};

test("Vorspann-Aufraeumen: das Aufraeumen des Sweep-Takts loescht die abgelaufene Zeile von Mandant B, ohne dass B anlegt; Zukunftszeilen beider Mandanten bleiben", async () => {
  await anlegen(B, "va_b_alt", "-1 hour");
  await anlegen(A, "va_a_alt", "-1 second");
  await anlegen(B, "va_b_neu", "1 hour");
  await anlegen(A, "va_a_neu", "1 hour");
  await speicher.vorspannZustand.raeumeAbgelaufene();
  assert.equal(await zeile(B, "va_b_alt"), undefined);
  assert.equal(await zeile(A, "va_a_alt"), undefined);
  assert.deepEqual(await zeile(B, "va_b_neu"), { token: "tok_va_b_neu", text: "satz_va_b_neu" });
  assert.deepEqual(await zeile(A, "va_a_neu"), { token: "tok_va_a_neu", text: "satz_va_a_neu" });
});

test("Vorspann-Aufraeumen: anlegen loescht weiterhin abgelaufene Zeilen des eigenen Mandanten", async () => {
  await anlegen(A, "va_a_eigen_alt", "-1 hour");
  await speicher.vorspannZustand.anlegen({ tenantId: A, callId: "va_a_eigen_neu", token: "t", text: "s", ttlMs: 60_000 });
  assert.equal(await zeile(A, "va_a_eigen_alt"), undefined);
  assert.equal((await zeile(A, "va_a_eigen_neu")).text, "s");
});
